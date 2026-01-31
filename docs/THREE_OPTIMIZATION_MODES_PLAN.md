# Three Optimization Modes: Implementation Plan

This document outlines the implementation of three distinct optimization algorithms for the unified flights + hotels ILP, each with different objectives and trade-offs.

## Table of Contents

1. [Overview](#overview)
2. [Mode Definitions](#mode-definitions)
3. [Mathematical Formulations](#mathematical-formulations)
4. [Balanced Mode: Normalization Algorithm](#balanced-mode-normalization-algorithm)
5. [Implementation Architecture](#implementation-architecture)
6. [Code Structure](#code-structure)
7. [Testing Strategy](#testing-strategy)
8. [Implementation Phases](#implementation-phases)

---

## Overview

### The Three Modes

| Mode | Primary Goal | When to Use | Points Usage |
|------|--------------|-------------|--------------|
| **OOP (Out-of-Pocket)** | Minimize cash paid | Have lots of points, want to spend minimal cash | Use points whenever cpp > 0 |
| **CPP (Cents-Per-Point)** | Maximize redemption value | Want best "deal" for points, preserve for premium | Only use when cpp > threshold (e.g., 1.5¢) |
| **Balanced** | Optimize value per hour per stop | Want best overall trip experience | Use when adjusted_cpp > normalized_threshold |

### Key Design Principle

All three modes share:
- **Same ILP structure** (variables, base constraints)
- **Same unified flights + hotels model**
- **Same transfer pool constraints**

Only the **objective function** differs between modes.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           UNIFIED ILP MODEL                                      │
│                                                                                 │
│  Variables:     x_flight, x_hotel, y_flight, y_hotel, t_blocks                 │
│  Constraints:   Path, Payment, Transfer, Date Alignment (SAME for all modes)   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    OBJECTIVE FUNCTION (MODE-SPECIFIC)                    │   │
│  │                                                                         │   │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────────┐  │   │
│  │   │  OOP Mode   │   │  CPP Mode   │   │      Balanced Mode          │  │   │
│  │   │             │   │             │   │                             │  │   │
│  │   │ Min cash    │   │ Max cpp     │   │ Max cpp/(time × stops)     │  │   │
│  │   │ cpp > 0     │   │ cpp > 1.5   │   │ with normalization         │  │   │
│  │   └─────────────┘   └─────────────┘   └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Mode Definitions

### Mode 1: OOP (Out-of-Pocket) - Minimize Cash

**Philosophy:** "I have points to burn. I want to pay as little cash as possible."

**Behavior:**
- Uses points whenever they reduce cash (cpp > 0)
- Accepts "bad" redemptions if they save money
- Prefers low-surcharge awards (even at low cpp)
- Will take longer flights or more stops if significantly cheaper

**CPP Threshold:** 0 (any positive value)

**Example Decision:**
```
Flight A: $800 cash OR 80,000 miles + $200 surcharge
CPP = ($800 - $200) / 80,000 = 0.75¢

OOP Mode: ✅ USE POINTS (saves $600 cash, even though cpp is "bad")
```

**Target User:** Points-rich travelers who want minimal out-of-pocket spending.

---

### Mode 2: CPP (Cents-Per-Point) - Maximize Redemption Value

**Philosophy:** "My points are valuable. I only use them for premium redemptions."

**Behavior:**
- Only uses points when cpp exceeds program-specific threshold
- Willing to pay more cash to preserve points for better future redemptions
- Prioritizes high-value awards (business class, premium hotels)
- Rejects "devalued" redemptions

**CPP Thresholds (Program-Specific):**
| Program | Threshold | Rationale |
|---------|-----------|-----------|
| Hyatt | 1.5¢ | Premium hotel value |
| United | 1.2¢ | Standard airline |
| Delta | 1.0¢ | Variable pricing |
| Hilton | 0.5¢ | Lower baseline value |
| British Airways | 1.8¢ | High surcharges need high cpp |

**Example Decision:**
```
Flight A: $400 cash OR 60,000 miles + $200 surcharge
CPP = ($400 - $200) / 60,000 = 0.33¢

CPP Mode: ❌ PAY CASH (0.33¢ < 1.2¢ threshold)
         "Save points for a better redemption"
```

**Target User:** Strategic points collectors who want maximum value extraction.

---

### Mode 3: Balanced - Value Per Hour Per Stop

**Philosophy:** "I want the best overall trip - good value, reasonable time, minimal hassle."

**Behavior:**
- Considers cpp, travel time, AND number of connections
- Normalizes these factors to a comparable scale
- May choose slightly lower cpp if flight is much shorter/more direct
- Balances cash savings against convenience

**Key Innovation: Normalized Comparison Metric**

```
Balanced_Score = (Points_Value) / (Time_Factor × Connection_Factor)

Where:
  Points_Value = cash_saved_by_using_points
  Time_Factor = max(1, total_hours / baseline_hours)
  Connection_Factor = 1 + (extra_connections × connection_penalty)
```

**Example Decision:**
```
Option A: JFK→TYO direct, 14h, 85K miles, $2,500 saved (2.9 cpp)
  Time_Factor = 14/10 = 1.4
  Connection_Factor = 1 + 0 = 1.0
  Balanced_Score = 2500 / (1.4 × 1.0) = 1786

Option B: JFK→LAX→TYO, 18h, 70K miles, $2,100 saved (3.0 cpp)
  Time_Factor = 18/10 = 1.8
  Connection_Factor = 1 + 1×0.3 = 1.3
  Balanced_Score = 2100 / (1.8 × 1.3) = 897

Balanced Mode: ✅ CHOOSE OPTION A (higher balanced score despite lower raw cpp)
```

**Target User:** Travelers who value overall trip quality, not just points value.

---

## Mathematical Formulations

### Shared Components (All Modes)

```
SETS:
  T = travelers
  F = flight edges
  H = hotel edges  
  S = bank sources
  A = airline programs
  P = hotel programs

VARIABLES:
  x_f[f] ∈ {0,1}              Flight selection
  x_h[h] ∈ {0,1}              Hotel selection
  y_f[s,a,f] ∈ {0,1}          Flight points payment
  y_h[s,p,h] ∈ {0,1}          Hotel points payment
  z_f[f] ∈ {0,1}              Flight cash payment
  z_h[h] ∈ {0,1}              Hotel cash payment
  t[s,prog] ∈ Z⁺              Transfer blocks

PARAMETERS:
  cash_f[f] = cash cost of flight f
  cash_h[h] = cash cost of hotel h
  miles_f[a,f] = miles for flight f via airline a
  points_h[p,h] = points for hotel h via program p
  surcharge_f[a,f] = surcharge for flight award
  surcharge_h[p,h] = surcharge for hotel award
  time_f[f] = travel time of flight f (minutes)
  stops_f[f] = number of stops in flight f

DERIVED:
  value_f[a,f] = cash_f[f] - surcharge_f[a,f]     (cash saved by using points)
  value_h[p,h] = cash_h[h] - surcharge_h[p,h]
  cpp_f[a,f] = 100 × value_f[a,f] / miles_f[a,f]  (cents per point)
  cpp_h[p,h] = 100 × value_h[p,h] / points_h[p,h]

CONSTRAINTS (Shared):
  (1) Path constraints (flights)
  (2) Hotel selection (one per destination)
  (3) Payment exclusivity
  (4) Transfer sufficiency
  (5) Source balance (coupling constraint)
  (6) Date alignment
```

---

### Mode 1: OOP Objective

```
OBJECTIVE (OOP Mode):
═══════════════════

Maximize:
    ┌─────────────────────────────────────────────────────────────────────┐
    │  FLIGHT POINTS VALUE (any cpp > 0)                                  │
    │  Σ_f Σ_(s,a) y_f[s,a,f] × value_f[a,f]                             │
    │  where value_f[a,f] > 0                                             │
    └─────────────────────────────────────────────────────────────────────┘
  + ┌─────────────────────────────────────────────────────────────────────┐
    │  HOTEL POINTS VALUE (any cpp > 0)                                   │
    │  Σ_h Σ_(s,p) y_h[s,p,h] × value_h[p,h]                             │
    │  where value_h[p,h] > 0                                             │
    └─────────────────────────────────────────────────────────────────────┘
  - ┌─────────────────────────────────────────────────────────────────────┐
    │  TOTAL CASH (strongly penalized)                                    │
    │  W_cash × (Σ_f z_f[f] × cash_f[f] + Σ_h z_h[h] × cash_h[h]         │
    │          + Σ surcharges)                                            │
    └─────────────────────────────────────────────────────────────────────┘
  - W_time × total_travel_time              (minor time penalty)
  - W_stops × extra_connections             (minor connection penalty)
  - W_routing × non_hub_transits            (avoid obscure routing)

WEIGHTS (OOP):
  W_value = 10^8         Very high reward for using points
  W_cash = 10^7          Very high penalty for cash
  W_time = 10^1          Low time penalty (accept longer flights)
  W_stops = 10^5         Moderate connection penalty
  W_routing = 10^6       Penalize non-hub transits

CPP FILTER: value > 0 (any positive savings)
```

---

### Mode 2: CPP Objective

```
OBJECTIVE (CPP Mode):
════════════════════

Maximize:
    ┌─────────────────────────────────────────────────────────────────────┐
    │  FLIGHT POINTS VALUE (only high cpp)                                │
    │  Σ_f Σ_(s,a) y_f[s,a,f] × value_f[a,f]                             │
    │  where cpp_f[a,f] > CPP_THRESHOLD[a]                               │
    └─────────────────────────────────────────────────────────────────────┘
  + ┌─────────────────────────────────────────────────────────────────────┐
    │  HOTEL POINTS VALUE (only high cpp)                                 │
    │  Σ_h Σ_(s,p) y_h[s,p,h] × value_h[p,h]                             │
    │  where cpp_h[p,h] > CPP_THRESHOLD[p]                               │
    └─────────────────────────────────────────────────────────────────────┘
  - ┌─────────────────────────────────────────────────────────────────────┐
    │  TOTAL CASH (moderately penalized)                                  │
    │  W_cash × total_cash                                               │
    └─────────────────────────────────────────────────────────────────────┘
  - W_surcharge × excessive_surcharges      (penalize high surcharges)
  - W_time × total_travel_time              (moderate time penalty)
  - W_stops × extra_connections             (strong connection penalty)

WEIGHTS (CPP):
  W_value = 10^7         High reward for good cpp redemptions
  W_cash = 10^4          Moderate cash penalty (willing to pay more)
  W_surcharge = 10^5     High surcharge penalty (hurts cpp)
  W_time = 10^3          Moderate time penalty
  W_stops = 10^6         Strong connection penalty

CPP THRESHOLDS:
  CPP_THRESHOLD = {
      "HYATT": 1.5, "MAR": 0.8, "HH": 0.5, "IHG": 0.6,  # Hotels
      "UA": 1.2, "AA": 1.2, "DL": 1.0, "BA": 1.8,       # Airlines
      "default": 1.2
  }

CPP FILTER: cpp > CPP_THRESHOLD[program]
```

---

### Mode 3: Balanced Objective

```
OBJECTIVE (Balanced Mode):
══════════════════════════

STEP 1: Calculate Normalized Scores
───────────────────────────────────

For each flight edge f with award via airline a:
  
  raw_value_f = cash_f[f] - surcharge_f[a,f]
  
  time_hours = time_f[f] / 60
  time_factor = max(1.0, time_hours / BASELINE_HOURS)
  
  connection_factor = 1.0 + stops_f[f] × CONNECTION_PENALTY
  
  balanced_score_f[a,f] = raw_value_f / (time_factor × connection_factor)

For each hotel edge h with award via program p:
  
  raw_value_h = cash_h[h] - surcharge_h[p,h]
  
  # Hotels have no time/connection factors
  # But we can add quality factors:
  quality_factor = QUALITY_BONUS[star_rating] or 1.0
  
  balanced_score_h[p,h] = raw_value_h × quality_factor

STEP 2: Normalize to Comparable Scale
─────────────────────────────────────

# Compute normalization constants (see next section)
K_flight = compute_flight_normalization(all_flight_options)
K_hotel = compute_hotel_normalization(all_hotel_options)

normalized_flight_score[a,f] = balanced_score_f[a,f] / K_flight
normalized_hotel_score[p,h] = balanced_score_h[p,h] / K_hotel

STEP 3: Objective Function
──────────────────────────

Maximize:
    ┌─────────────────────────────────────────────────────────────────────┐
    │  NORMALIZED FLIGHT VALUE                                            │
    │  Σ_f Σ_(s,a) y_f[s,a,f] × normalized_flight_score[a,f]             │
    │  where balanced_score_f[a,f] > MIN_BALANCED_THRESHOLD              │
    └─────────────────────────────────────────────────────────────────────┘
  + ┌─────────────────────────────────────────────────────────────────────┐
    │  NORMALIZED HOTEL VALUE                                             │
    │  Σ_h Σ_(s,p) y_h[s,p,h] × normalized_hotel_score[p,h]              │
    │  where balanced_score_h[p,h] > MIN_BALANCED_THRESHOLD              │
    └─────────────────────────────────────────────────────────────────────┘
  - W_cash × total_cash                     (balanced cash penalty)
  - W_time × total_travel_time              (significant time penalty)
  - W_stops × extra_connections             (significant connection penalty)

WEIGHTS (Balanced):
  W_value = 10^6         Balanced reward
  W_cash = 10^5          Moderate cash penalty
  W_time = 10^4          Significant time penalty (part of balanced scoring)
  W_stops = 10^5         Significant connection penalty

PARAMETERS:
  BASELINE_HOURS = 10              10 hours = "standard" long-haul
  CONNECTION_PENALTY = 0.3         Each stop reduces score by 30%
  MIN_BALANCED_THRESHOLD = 0.5    Minimum normalized score to use points
  
  QUALITY_BONUS = {
      5.0: 1.2,    # 5-star hotels get 20% bonus
      4.5: 1.1,    # 4.5-star gets 10% bonus
      4.0: 1.0,    # 4-star is baseline
      3.5: 0.9,    # Lower ratings penalized
  }
```

---

## Balanced Mode: Normalization Algorithm

### The Problem

Flight and hotel "value" are not directly comparable:
- Flight: $2,500 saved on a 14-hour flight
- Hotel: $600 saved on a 7-night stay

We need a **normalization constant** to put these on the same scale.

### Normalization Approach

```python
def compute_normalization_constants(flight_edges, hotel_edges):
    """
    Compute normalization constants that make flight and hotel scores comparable.
    
    Strategy: Use the median "value per unit" as the baseline.
    - Flights: value per hour of travel
    - Hotels: value per night
    """
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHT NORMALIZATION
    # ════════════════════════════════════════════════════════════════════
    
    flight_value_per_hour = []
    for f in flight_edges:
        for a in airlines:
            if has_award(f, a):
                value = cash_cost[f] - surcharge[a][f]
                hours = time_cost[f] / 60
                stops = num_stops[f]
                
                # Adjusted value per hour (penalize connections)
                connection_factor = 1.0 + stops * 0.3
                adjusted_hours = hours * connection_factor
                
                value_per_adjusted_hour = value / max(1, adjusted_hours)
                flight_value_per_hour.append(value_per_adjusted_hour)
    
    # K_flight = median value per adjusted hour
    # This represents "typical" flight value density
    K_flight = median(flight_value_per_hour) if flight_value_per_hour else 100.0
    
    # ════════════════════════════════════════════════════════════════════
    # HOTEL NORMALIZATION
    # ════════════════════════════════════════════════════════════════════
    
    hotel_value_per_night = []
    for h in hotel_edges:
        for p in hotel_programs:
            if has_award(h, p):
                value = cash_cost[h] - surcharge[p][h]
                nights = num_nights[h]
                
                # Quality adjustment
                quality_factor = QUALITY_BONUS.get(star_rating[h], 1.0)
                adjusted_nights = nights / quality_factor
                
                value_per_adjusted_night = value / max(1, adjusted_nights)
                hotel_value_per_night.append(value_per_adjusted_night)
    
    # K_hotel = median value per adjusted night
    K_hotel = median(hotel_value_per_night) if hotel_value_per_night else 150.0
    
    # ════════════════════════════════════════════════════════════════════
    # CROSS-CATEGORY NORMALIZATION
    # ════════════════════════════════════════════════════════════════════
    
    # Now we need to make K_flight and K_hotel comparable.
    # 
    # Intuition: A "typical" long-haul flight (10h) should be comparable
    # to a "typical" hotel stay (5 nights) in terms of trip contribution.
    #
    # So we normalize such that:
    #   10h flight value ≈ 5 night hotel value (in the objective)
    
    FLIGHT_UNIT = 10.0   # 10 hours = 1 flight "unit"
    HOTEL_UNIT = 5.0     # 5 nights = 1 hotel "unit"
    
    # Compute "unit values"
    flight_unit_value = K_flight * FLIGHT_UNIT
    hotel_unit_value = K_hotel * HOTEL_UNIT
    
    # Scale factors to normalize both to [0, 1] range approximately
    scale_flight = 1.0 / flight_unit_value if flight_unit_value > 0 else 1.0
    scale_hotel = 1.0 / hotel_unit_value if hotel_unit_value > 0 else 1.0
    
    return {
        "K_flight": K_flight,
        "K_hotel": K_hotel,
        "scale_flight": scale_flight,
        "scale_hotel": scale_hotel,
        "flight_unit_value": flight_unit_value,
        "hotel_unit_value": hotel_unit_value,
    }
```

### Using Normalization in the Objective

```python
def build_balanced_objective(model, flight_vars, hotel_vars, normalization):
    """
    Build the balanced mode objective with normalized scores.
    """
    
    K_flight = normalization["K_flight"]
    K_hotel = normalization["K_hotel"]
    scale_flight = normalization["scale_flight"]
    scale_hotel = normalization["scale_hotel"]
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHT VALUE EXPRESSION
    # ════════════════════════════════════════════════════════════════════
    
    flight_value_expr = []
    for f in flight_edges:
        for (s, a) in transfer_paths:
            if not has_award(f, a):
                continue
            
            # Raw value
            raw_value = cash_cost[f] - surcharge[a][f]
            
            # Time and connection adjustments
            hours = time_cost[f] / 60
            time_factor = max(1.0, hours / BASELINE_HOURS)
            connection_factor = 1.0 + num_stops[f] * CONNECTION_PENALTY
            
            # Balanced score
            balanced_score = raw_value / (time_factor * connection_factor)
            
            # Normalized score (scaled to be comparable with hotels)
            normalized_score = balanced_score * scale_flight
            
            # Only include if above threshold
            if balanced_score / K_flight > MIN_BALANCED_THRESHOLD:
                flight_value_expr.append(
                    y_flight[(s, a)][f] * normalized_score
                )
    
    # ════════════════════════════════════════════════════════════════════
    # HOTEL VALUE EXPRESSION
    # ════════════════════════════════════════════════════════════════════
    
    hotel_value_expr = []
    for h in hotel_edges:
        for (s, p) in transfer_paths:
            if not has_award(h, p):
                continue
            
            # Raw value
            raw_value = cash_cost[h] - surcharge[p][h]
            
            # Quality adjustment
            quality_factor = QUALITY_BONUS.get(star_rating[h], 1.0)
            
            # Balanced score (hotels don't have time/connection penalties)
            balanced_score = raw_value * quality_factor
            
            # Normalized score
            normalized_score = balanced_score * scale_hotel
            
            # Only include if above threshold
            if balanced_score / K_hotel > MIN_BALANCED_THRESHOLD:
                hotel_value_expr.append(
                    y_hotel[(s, p)][h] * normalized_score
                )
    
    # ════════════════════════════════════════════════════════════════════
    # COMBINED OBJECTIVE
    # ════════════════════════════════════════════════════════════════════
    
    total_value = lpSum(flight_value_expr) + lpSum(hotel_value_expr)
    
    # Cash penalty
    total_cash = (
        lpSum(z_flight[f] * cash_cost[f] for f in flight_edges)
        + lpSum(z_hotel[h] * cash_cost[h] for h in hotel_edges)
        + lpSum(surcharges_paid)
    )
    
    # Time penalty (flights only)
    total_time = lpSum(x_flight[f] * time_cost[f] for f in flight_edges)
    
    # Connection penalty (flights only)
    total_stops = lpSum(x_flight[f] * num_stops[f] for f in flight_edges)
    
    # Objective
    model += (
        W_VALUE * total_value
        - W_CASH * total_cash
        - W_TIME * total_time
        - W_STOPS * total_stops
    )
```

---

## Implementation Architecture

### File Structure

```
backend/src/
├── handlers/
│   ├── points_maximizer.py          # REFACTOR: Mode dispatcher
│   ├── optimization_modes/          # NEW: Mode-specific logic
│   │   ├── __init__.py
│   │   ├── base.py                  # Abstract base class
│   │   ├── oop_mode.py              # OOP objective builder
│   │   ├── cpp_mode.py              # CPP objective builder
│   │   └── balanced_mode.py         # Balanced objective + normalization
│   └── ilp_adapter.py               # Extended for hotels
├── optimization/
│   ├── constants.py                 # Mode-specific thresholds
│   ├── models.py                    # Add OptimizationMode enum
│   └── normalization.py             # NEW: Normalization algorithms
```

### Class Design

```python
# base.py
from abc import ABC, abstractmethod
from typing import Dict, Any
import pulp as pl

class OptimizationMode(ABC):
    """Abstract base class for optimization modes."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Mode identifier."""
        pass
    
    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description."""
        pass
    
    @abstractmethod
    def should_use_points(self, program: str, cpp: float, **kwargs) -> bool:
        """Determine if points should be used for this redemption."""
        pass
    
    @abstractmethod
    def build_objective(
        self,
        model: pl.LpProblem,
        variables: Dict[str, Any],
        costs: Dict[str, Any],
        **kwargs
    ) -> None:
        """Add the mode-specific objective function to the model."""
        pass
    
    @abstractmethod
    def get_weights(self) -> Dict[str, float]:
        """Return the objective weights for this mode."""
        pass


# oop_mode.py
class OOPMode(OptimizationMode):
    """Out-of-Pocket mode: Minimize cash paid."""
    
    @property
    def name(self) -> str:
        return "oop"
    
    @property
    def description(self) -> str:
        return "Minimize out-of-pocket cash. Uses points whenever they save money."
    
    def should_use_points(self, program: str, cpp: float, **kwargs) -> bool:
        # Use points if cpp > 0 (any savings)
        return cpp > 0.0
    
    def get_weights(self) -> Dict[str, float]:
        return {
            "W_VALUE": 1e8,
            "W_CASH": 1e7,
            "W_TIME": 1e1,
            "W_STOPS": 1e5,
            "W_ROUTING": 1e6,
        }
    
    def build_objective(self, model, variables, costs, **kwargs):
        # ... OOP-specific objective
        pass


# cpp_mode.py
class CPPMode(OptimizationMode):
    """CPP mode: Maximize redemption value."""
    
    CPP_THRESHOLDS = {
        "HYATT": 1.5, "MAR": 0.8, "HH": 0.5, "IHG": 0.6,
        "UA": 1.2, "AA": 1.2, "DL": 1.0, "BA": 1.8,
        "default": 1.2
    }
    
    @property
    def name(self) -> str:
        return "cpp"
    
    @property
    def description(self) -> str:
        return "Maximize cents-per-point value. Only uses points for premium redemptions."
    
    def should_use_points(self, program: str, cpp: float, **kwargs) -> bool:
        threshold = self.CPP_THRESHOLDS.get(program, self.CPP_THRESHOLDS["default"])
        return cpp >= threshold
    
    def get_weights(self) -> Dict[str, float]:
        return {
            "W_VALUE": 1e7,
            "W_CASH": 1e4,
            "W_SURCHARGE": 1e5,
            "W_TIME": 1e3,
            "W_STOPS": 1e6,
        }
    
    def build_objective(self, model, variables, costs, **kwargs):
        # ... CPP-specific objective
        pass


# balanced_mode.py
class BalancedMode(OptimizationMode):
    """Balanced mode: Optimize value per hour per stop."""
    
    BASELINE_HOURS = 10.0
    CONNECTION_PENALTY = 0.3
    MIN_THRESHOLD = 0.5
    
    QUALITY_BONUS = {5.0: 1.2, 4.5: 1.1, 4.0: 1.0, 3.5: 0.9}
    
    @property
    def name(self) -> str:
        return "balanced"
    
    @property
    def description(self) -> str:
        return "Balance value, time, and convenience. Best overall trip experience."
    
    def should_use_points(self, program: str, cpp: float, **kwargs) -> bool:
        # Check normalized score against threshold
        normalized_score = kwargs.get("normalized_score", 0)
        return normalized_score >= self.MIN_THRESHOLD
    
    def compute_normalization(self, flight_edges, hotel_edges, costs):
        """Compute normalization constants for cross-category comparison."""
        # ... normalization algorithm from above
        pass
    
    def compute_flight_score(self, edge, airline, costs, normalization):
        """Compute normalized balanced score for a flight."""
        raw_value = costs["cash"][edge] - costs["surcharge"][airline][edge]
        hours = costs["time"][edge] / 60
        stops = costs["stops"][edge]
        
        time_factor = max(1.0, hours / self.BASELINE_HOURS)
        connection_factor = 1.0 + stops * self.CONNECTION_PENALTY
        
        balanced_score = raw_value / (time_factor * connection_factor)
        normalized_score = balanced_score * normalization["scale_flight"]
        
        return balanced_score, normalized_score
    
    def compute_hotel_score(self, edge, program, costs, normalization):
        """Compute normalized balanced score for a hotel."""
        raw_value = costs["cash"][edge] - costs["surcharge"][program][edge]
        stars = costs.get("star_rating", {}).get(edge, 4.0)
        quality_factor = self.QUALITY_BONUS.get(stars, 1.0)
        
        balanced_score = raw_value * quality_factor
        normalized_score = balanced_score * normalization["scale_hotel"]
        
        return balanced_score, normalized_score
    
    def get_weights(self) -> Dict[str, float]:
        return {
            "W_VALUE": 1e6,
            "W_CASH": 1e5,
            "W_TIME": 1e4,
            "W_STOPS": 1e5,
        }
    
    def build_objective(self, model, variables, costs, **kwargs):
        # ... Balanced-specific objective with normalization
        pass
```

---

## Code Structure

### Mode Dispatcher

```python
# points_maximizer.py (refactored)

from handlers.optimization_modes import OOPMode, CPPMode, BalancedMode

OPTIMIZATION_MODES = {
    "oop": OOPMode(),
    "cpp": CPPMode(),
    "balanced": BalancedMode(),
}

def plan_maximize_points_value(
    # ... all existing parameters ...
    optimization_mode: str = "oop",
):
    """
    Unified ILP optimizer for flights + hotels.
    
    Args:
        optimization_mode: One of "oop", "cpp", or "balanced"
    """
    
    # Get mode handler
    mode = OPTIMIZATION_MODES.get(optimization_mode)
    if mode is None:
        raise ValueError(f"Unknown optimization mode: {optimization_mode}")
    
    logger.info(f"Running optimization in {mode.name} mode: {mode.description}")
    
    # ════════════════════════════════════════════════════════════════════
    # BUILD MODEL (same for all modes)
    # ════════════════════════════════════════════════════════════════════
    
    m = pl.LpProblem("UnifiedOptimization", pl.LpMaximize)
    
    # Create variables (same for all modes)
    x_flight = create_flight_selection_vars(...)
    x_hotel = create_hotel_selection_vars(...)
    y_flight = create_flight_payment_vars(...)
    y_hotel = create_hotel_payment_vars(...)
    z_flight = create_flight_cash_vars(...)
    z_hotel = create_hotel_cash_vars(...)
    t_blocks = create_transfer_vars(...)
    
    # Add constraints (same for all modes)
    add_path_constraints(m, ...)
    add_hotel_selection_constraints(m, ...)
    add_payment_constraints(m, ...)
    add_transfer_constraints(m, ...)  # UNIFIED: flights + hotels
    add_date_alignment_constraints(m, ...)
    
    # ════════════════════════════════════════════════════════════════════
    # BUILD OBJECTIVE (mode-specific)
    # ════════════════════════════════════════════════════════════════════
    
    variables = {
        "x_flight": x_flight,
        "x_hotel": x_hotel,
        "y_flight": y_flight,
        "y_hotel": y_hotel,
        "z_flight": z_flight,
        "z_hotel": z_hotel,
        "t_blocks": t_blocks,
    }
    
    costs = {
        "cash_flight": cash_cost_flight,
        "cash_hotel": cash_cost_hotel,
        "surcharge_flight": surcharge_flight,
        "surcharge_hotel": surcharge_hotel,
        "time": time_cost,
        "stops": stop_count,
        "star_rating": star_ratings,
    }
    
    # Mode-specific pre-computation (e.g., normalization for balanced)
    mode_context = {}
    if mode.name == "balanced":
        mode_context["normalization"] = mode.compute_normalization(
            flight_edges, hotel_edges, costs
        )
    
    # Build objective function
    mode.build_objective(m, variables, costs, **mode_context)
    
    # ════════════════════════════════════════════════════════════════════
    # SOLVE AND EXTRACT
    # ════════════════════════════════════════════════════════════════════
    
    m.solve(pl.PULP_CBC_CMD(msg=False))
    
    solution = extract_solution(m, variables, mode)
    solution["optimization_mode"] = mode.name
    
    return solution
```

---

## Testing Strategy

### Unit Tests for Each Mode

```python
# test_optimization_modes.py

class TestOOPMode:
    """Tests for OOP (Out-of-Pocket) mode."""
    
    def test_uses_points_when_any_savings(self):
        """OOP should use points even at 0.5 cpp."""
        mode = OOPMode()
        assert mode.should_use_points("UA", cpp=0.5) == True
        assert mode.should_use_points("HYATT", cpp=0.3) == True
    
    def test_rejects_negative_cpp(self):
        """OOP should reject when surcharge > cash price."""
        mode = OOPMode()
        assert mode.should_use_points("UA", cpp=-0.5) == False
    
    def test_prefers_lower_cash_over_better_cpp(self):
        """OOP should choose option that minimizes cash."""
        # Option A: $500 cash, 2.0 cpp
        # Option B: $200 cash, 0.8 cpp
        # OOP should prefer B
        pass


class TestCPPMode:
    """Tests for CPP (Cents-Per-Point) mode."""
    
    def test_uses_points_above_threshold(self):
        """CPP should use points when above program threshold."""
        mode = CPPMode()
        assert mode.should_use_points("HYATT", cpp=2.0) == True  # > 1.5
        assert mode.should_use_points("UA", cpp=1.5) == True     # > 1.2
    
    def test_rejects_points_below_threshold(self):
        """CPP should reject points below threshold."""
        mode = CPPMode()
        assert mode.should_use_points("HYATT", cpp=1.0) == False  # < 1.5
        assert mode.should_use_points("UA", cpp=0.8) == False     # < 1.2
    
    def test_uses_program_specific_thresholds(self):
        """CPP thresholds should vary by program."""
        mode = CPPMode()
        # Same cpp, different programs
        assert mode.should_use_points("HH", cpp=0.6) == True   # > 0.5 (Hilton)
        assert mode.should_use_points("HYATT", cpp=0.6) == False  # < 1.5 (Hyatt)


class TestBalancedMode:
    """Tests for Balanced mode."""
    
    def test_penalizes_long_flights(self):
        """Longer flights should have lower balanced scores."""
        mode = BalancedMode()
        
        # Same value, different times
        score_short = mode.compute_flight_score(
            value=2000, hours=8, stops=0
        )
        score_long = mode.compute_flight_score(
            value=2000, hours=16, stops=0
        )
        
        assert score_short > score_long
    
    def test_penalizes_connections(self):
        """More stops should have lower balanced scores."""
        mode = BalancedMode()
        
        # Same value and time, different stops
        score_direct = mode.compute_flight_score(
            value=2000, hours=10, stops=0
        )
        score_connection = mode.compute_flight_score(
            value=2000, hours=10, stops=1
        )
        
        assert score_direct > score_connection
    
    def test_normalization_makes_flights_hotels_comparable(self):
        """Normalized scores should be in similar ranges."""
        mode = BalancedMode()
        
        normalization = mode.compute_normalization(
            flight_edges=[...],
            hotel_edges=[...],
            costs={...}
        )
        
        # Check that unit values are in similar range
        ratio = (normalization["flight_unit_value"] / 
                 normalization["hotel_unit_value"])
        assert 0.5 < ratio < 2.0  # Should be roughly comparable


class TestModeComparison:
    """Tests comparing behavior across modes."""
    
    def test_same_solution_when_clear_winner(self):
        """All modes should agree when one option dominates."""
        # Option A: $500 cash, 3.0 cpp, 8h direct
        # Option B: $800 cash, 0.5 cpp, 16h 2-stop
        # All modes should prefer A
        pass
    
    def test_different_solutions_with_tradeoffs(self):
        """Modes should differ when real tradeoffs exist."""
        # Option A: $200 cash, 0.8 cpp (OOP prefers)
        # Option B: $500 cash, 2.0 cpp (CPP prefers)
        pass
```

### Integration Tests

```python
def test_unified_optimization_flights_plus_hotels():
    """Test that all modes work with unified flights + hotels."""
    
    edges = {
        # Flights
        ("JFK", "NRT", "NH10"): {...},
        ("NRT", "JFK", "NH11"): {...},
        # Hotels
        ("NRT", "hyatt_park", "2026-03-01", "2026-03-08"): {...},
        ("NRT", "marriott", "2026-03-01", "2026-03-08"): {...},
    }
    
    user_points = {"Chase": 300000, "Hyatt": 50000}
    
    for mode in ["oop", "cpp", "balanced"]:
        result = run_optimization(
            edges=edges,
            user_points=user_points,
            optimization_mode=mode
        )
        
        assert result["status"] == "Optimal"
        assert "flights" in result
        assert "hotels" in result
        assert result["optimization_mode"] == mode
```

---

## Implementation Phases

### Phase 1: Refactor Mode Architecture (Week 1)

**Tasks:**
1. [ ] Create `optimization_modes/` directory structure
2. [ ] Define `OptimizationMode` base class
3. [ ] Extract current OOP logic into `OOPMode` class
4. [ ] Add mode dispatcher to `points_maximizer.py`
5. [ ] Unit tests for OOP mode

**Deliverable:** Existing OOP mode works via new architecture.

### Phase 2: Implement CPP Mode (Week 2)

**Tasks:**
1. [ ] Create `CPPMode` class
2. [ ] Implement program-specific thresholds
3. [ ] Build CPP objective function
4. [ ] Unit tests for CPP mode
5. [ ] Integration tests comparing OOP vs CPP

**Deliverable:** CPP mode produces different (higher-value) solutions.

### Phase 3: Implement Balanced Mode (Week 3)

**Tasks:**
1. [ ] Create `BalancedMode` class
2. [ ] Implement normalization algorithm
3. [ ] Add time/connection penalties
4. [ ] Add hotel quality bonuses
5. [ ] Build balanced objective function
6. [ ] Unit tests for normalization
7. [ ] Unit tests for balanced scoring

**Deliverable:** Balanced mode produces convenience-adjusted solutions.

### Phase 4: Integrate with Hotels (Week 4)

**Tasks:**
1. [ ] Extend all three modes to handle hotel edges
2. [ ] Add hotel-specific thresholds (CPP mode)
3. [ ] Add hotel quality factors (Balanced mode)
4. [ ] Update normalization for cross-category comparison
5. [ ] Integration tests with flights + hotels

**Deliverable:** All three modes work with unified flights + hotels.

### Phase 5: API and Frontend (Week 5)

**Tasks:**
1. [ ] Update API to accept `optimization_mode` parameter
2. [ ] Add mode descriptions to response
3. [ ] Frontend mode selector UI
4. [ ] Documentation for users

**Deliverable:** Users can select optimization mode in the app.

---

## Summary

### Mode Comparison Table

| Aspect | OOP | CPP | Balanced |
|--------|-----|-----|----------|
| **Goal** | Min cash | Max cpp | Best experience |
| **Points threshold** | cpp > 0 | cpp > 1.2+ | normalized > 0.5 |
| **Time penalty** | Low | Moderate | High |
| **Connection penalty** | Moderate | Strong | Strong |
| **Cash penalty** | Very high | Moderate | Moderate |
| **Best for** | Points-rich | Value-seekers | Quality-focused |

### Key Implementation Insight

All three modes share **the same ILP structure**:
- Same variables
- Same constraints (including unified transfer pool)
- **Only the objective function changes**

This makes implementation clean and maintainable:

```python
# The core ILP is built once
model = build_unified_ilp(flights, hotels, transfers)

# Only the objective varies by mode
mode.build_objective(model, variables, costs)

# Solve and extract (same for all modes)
solution = solve_and_extract(model)
```
