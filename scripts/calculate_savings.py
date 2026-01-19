#!/usr/bin/env python3
"""
Calculate money saved from using points vs paying cash for trips.
Tracks running total of savings across all trips.
"""

import os
import json
from datetime import datetime
from typing import Dict, List, Any, Optional
from pathlib import Path
import boto3
from boto3.dynamodb.conditions import Key
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
SAVINGS_FILE = Path(__file__).parent.parent / "data" / "savings_tracker.json"
DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Default points value (cents per point)
DEFAULT_POINTS_VALUE = 0.01  # $0.01 per point
POINTS_VALUE_RATIO = 0.00004  # Alternative: $0.00004 per point (1 point = $0.01 / 250)


def get_dynamodb_table(table_name: str):
    """Get DynamoDB table resource"""
    dynamodb = boto3.resource(
        'dynamodb',
        region_name=os.environ.get('AWS_REGION', 'us-west-2')
    )
    return dynamodb.Table(table_name)


def get_all_trips(user_id: Optional[str] = None):
    """Get all trips from the database"""
    trips_table = get_dynamodb_table(os.environ.get('TRIPS_TABLE', ''))
    
    try:
        if user_id:
            # Get trips for specific user
            response = trips_table.scan(
                FilterExpression='createdBy = :uid',
                ExpressionAttributeValues={':uid': user_id}
            )
        else:
            # Get all trips
            response = trips_table.scan()
        
        return response.get('Items', [])
    except Exception as e:
        print(f"Error fetching trips: {e}")
        return []


def get_itinerary_for_trip(trip_id: str):
    """Get itinerary for a specific trip"""
    itinerary_table = get_dynamodb_table(os.environ.get('ITINERARY_TABLE', ''))
    
    try:
        response = itinerary_table.query(
            KeyConditionExpression=Key('tripId').eq(trip_id)
        )
        return response.get('Items', [])
    except Exception as e:
        print(f"Error fetching itinerary for trip {trip_id}: {e}")
        return []


def get_points_for_trip(trip_id: str):
    """Get points used for a specific trip"""
    points_table = get_dynamodb_table(os.environ.get('POINTS_TABLE', ''))
    
    try:
        response = points_table.query(
            KeyConditionExpression=Key('tripId').eq(trip_id)
        )
        items = response.get('Items', [])
        
        # Calculate total points used
        total_points = 0
        for item in items:
            balance = item.get('balance', 0)
            if isinstance(balance, (int, float)):
                total_points += balance
        
        return total_points
    except Exception as e:
        print(f"Error fetching points for trip {trip_id}: {e}")
        return 0


def calculate_points_value(points: int, cash_cost: float = 0, points_cost: int = 0) -> float:
    """
    Calculate the dollar value of points used.
    
    Uses the ratio from the trip if available, otherwise uses default value.
    """
    if points_cost > 0 and cash_cost > 0:
        # Use the ratio from this specific trip
        points_value_per_point = cash_cost / points_cost
        return points * points_value_per_point
    else:
        # Use default value
        return points * DEFAULT_POINTS_VALUE


def calculate_trip_savings(trip: Dict[str, Any], itinerary_items: List[Dict], points_used: int) -> Dict[str, Any]:
    """
    Calculate savings for a single trip.
    
    Savings = Cash price - (Actual cash paid + Value of points used)
    
    For each itinerary:
    - totalCost: Full cash price if paying with cash
    - pointsCost: Points needed if using points
    - If points were used: actual cash paid = surcharges/fees only
    """
    trip_id = trip.get('tripId', '')
    trip_title = trip.get('title', 'Unknown Trip')
    trip_date = trip.get('startDate', '')
    
    total_savings = 0.0
    total_cash_price = 0.0
    total_actual_cash = 0.0
    total_points_value = 0.0
    
    trip_savings = []
    
    for item in itinerary_items:
        # Get cost information
        cash_price = float(item.get('totalCost') or item.get('cost') or 0)
        points_needed = int(item.get('pointsCost') or item.get('points') or 0)
        actual_cash_paid = float(item.get('actualCashPaid') or 0)
        surcharge = float(item.get('surcharge') or item.get('pointsSurcharge') or 0)
        
        if cash_price == 0:
            continue  # Skip items with no cost data
        
        total_cash_price += cash_price
        
        # Calculate savings for this itinerary
        if points_needed > 0:
            # Points were used
            # Actual cash paid = surcharges/fees (usually 5-10% of cash price)
            if actual_cash_paid > 0:
                cash_spent = actual_cash_paid
            else:
                # Estimate: surcharges are typically 5-10% of cash price
                cash_spent = surcharge if surcharge > 0 else (cash_price * 0.05)
            
            # Calculate points value
            points_value = calculate_points_value(points_needed, cash_price, points_needed)
            total_points_value += points_value
            
            # Savings = cash price - (actual cash paid + points value)
            # Note: We consider points as "free" money (earned from credit cards)
            # So savings = cash price - actual cash paid
            savings = cash_price - cash_spent
            total_actual_cash += cash_spent
        else:
            # No points used, paid full cash
            savings = 0
            total_actual_cash += cash_price
        
        total_savings += savings
        
        trip_savings.append({
            'item_id': item.get('itemId', ''),
            'cash_price': cash_price,
            'actual_cash_paid': actual_cash_paid if points_needed > 0 else cash_price,
            'points_used': points_needed,
            'points_value': points_value if points_needed > 0 else 0,
            'savings': savings
        })
    
    return {
        'trip_id': trip_id,
        'trip_title': trip_title,
        'trip_date': trip_date,
        'total_cash_price': total_cash_price,
        'total_actual_cash': total_actual_cash,
        'total_points_used': points_used,
        'total_points_value': total_points_value,
        'total_savings': total_savings,
        'itinerary_breakdown': trip_savings,
        'calculated_at': datetime.now().isoformat()
    }


def load_savings_history() -> Dict[str, Any]:
    """Load savings history from file"""
    if SAVINGS_FILE.exists():
        try:
            with open(SAVINGS_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading savings history: {e}")
            return {'trips': [], 'total_savings': 0.0, 'last_updated': None}
    return {'trips': [], 'total_savings': 0.0, 'last_updated': None}


def save_savings_history(history: Dict[str, Any]):
    """Save savings history to file"""
    try:
        with open(SAVINGS_FILE, 'w') as f:
            json.dump(history, f, indent=2)
        print(f"✓ Savings history saved to {SAVINGS_FILE}")
    except Exception as e:
        print(f"Error saving savings history: {e}")


def update_running_total(new_trip_savings: Dict[str, Any], history: Dict[str, Any]) -> Dict[str, Any]:
    """Update running total with new trip savings"""
    trip_id = new_trip_savings['trip_id']
    
    # Remove old entry for this trip if it exists
    history['trips'] = [t for t in history['trips'] if t['trip_id'] != trip_id]
    
    # Add new entry
    history['trips'].append(new_trip_savings)
    
    # Recalculate total savings
    history['total_savings'] = sum(t.get('total_savings', 0) for t in history['trips'])
    history['last_updated'] = datetime.now().isoformat()
    
    return history


def calculate_all_savings(user_id: Optional[str] = None, update_file: bool = True):
    """Calculate savings for all trips"""
    print("=" * 60)
    print("TRIPY SAVINGS CALCULATOR")
    print("=" * 60)
    print()
    
    # Load existing history
    history = load_savings_history()
    print(f"Current total savings: ${history['total_savings']:,.2f}")
    print()
    
    # Get all trips
    print("Fetching trips from database...")
    trips = get_all_trips(user_id)
    print(f"Found {len(trips)} trip(s)")
    print()
    
    # Calculate savings for each trip
    new_calculations = []
    for trip in trips:
        trip_id = trip.get('tripId', '')
        trip_title = trip.get('title', 'Unknown Trip')
        
        print(f"Processing: {trip_title} ({trip_id[:8]}...)")
        
        # Get itinerary and points
        itinerary_items = get_itinerary_for_trip(trip_id)
        points_used = get_points_for_trip(trip_id)
        
        if not itinerary_items:
            print(f"  ⚠ No itinerary found, skipping")
            continue
        
        # Calculate savings
        trip_savings = calculate_trip_savings(trip, itinerary_items, points_used)
        new_calculations.append(trip_savings)
        
        # Update history
        if update_file:
            history = update_running_total(trip_savings, history)
        
        print(f"  Cash price: ${trip_savings['total_cash_price']:,.2f}")
        print(f"  Actual cash paid: ${trip_savings['total_actual_cash']:,.2f}")
        print(f"  Points used: {trip_savings['total_points_used']:,}")
        print(f"  Savings: ${trip_savings['total_savings']:,.2f}")
        print()
    
    # Save updated history
    if update_file:
        save_savings_history(history)
    
    # Print summary
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Trips processed: {len(new_calculations)}")
    print(f"Total savings: ${history['total_savings']:,.2f}")
    print(f"Average savings per trip: ${history['total_savings'] / len(new_calculations) if new_calculations else 0:,.2f}")
    print()
    
    return history, new_calculations


def print_detailed_report(history: Dict[str, Any]):
    """Print a detailed savings report"""
    print("=" * 60)
    print("DETAILED SAVINGS REPORT")
    print("=" * 60)
    print()
    
    trips = sorted(history['trips'], key=lambda x: x.get('trip_date', ''), reverse=True)
    
    for trip in trips:
        print(f"Trip: {trip['trip_title']}")
        print(f"  Date: {trip.get('trip_date', 'N/A')}")
        print(f"  Cash Price: ${trip['total_cash_price']:,.2f}")
        print(f"  Actual Cash Paid: ${trip['total_actual_cash']:,.2f}")
        print(f"  Points Used: {trip['total_points_used']:,}")
        print(f"  Savings: ${trip['total_savings']:,.2f}")
        print()


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Calculate money saved from using points')
    parser.add_argument('--user-id', type=str, help='Calculate savings for specific user only')
    parser.add_argument('--no-save', action='store_true', help='Calculate but do not save to file')
    parser.add_argument('--report', action='store_true', help='Show detailed report')
    parser.add_argument('--history-only', action='store_true', help='Show existing history only')
    
    args = parser.parse_args()
    
    if args.history_only:
        history = load_savings_history()
        print_detailed_report(history)
        print(f"\nTotal Savings: ${history['total_savings']:,.2f}")
    elif args.report:
        history = load_savings_history()
        print_detailed_report(history)
        print(f"\nTotal Savings: ${history['total_savings']:,.2f}")
    else:
        calculate_all_savings(
            user_id=args.user_id,
            update_file=not args.no_save
        )
