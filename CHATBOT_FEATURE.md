# Trip Planning Chatbot Feature

## Overview

A smart chatbot assistant that extracts trip information from natural language and automatically fills out the trip setup forms for both solo and group trips.

## Features

### ✅ What It Extracts

1. **Cities/Locations**
   - Multiple cities from phrases like "Paris and London" or "I want to visit Tokyo, Seoul, and Bangkok"
   - Recognizes 200+ common city names
   - Handles various formats and patterns

2. **Dates**
   - Specific dates: "March 15 to March 22, 2024"
   - ISO format: "2024-03-15 to 2024-03-22"
   - Relative dates: "next week", "next month"
   - Month ranges: "in March", "in April 2024"
   - Flexible dates: "flexible dates", "anytime"

3. **Duration**
   - "7 days", "2 weeks", "a month"
   - Automatically sets flexible dates mode if duration is provided

4. **Budget**
   - "$1000-$5000"
   - "between $2000 and $4000"
   - "budget of $3000"

5. **Credit Cards**
   - Recognizes major programs: Chase Sapphire, Amex Platinum, etc.
   - Extracts points: "Chase Sapphire with 150,000 points"

## How to Use

### For Users

1. **Open the Chatbot**
   - Click the chat icon (bottom-right corner) on solo or group trip setup pages
   - The chatbot window will slide up

2. **Type Your Trip Details**
   - Use natural language to describe your trip
   - Examples:
     - "I want to visit Paris and London in March with a $3000 budget"
     - "Trip to Tokyo for 7 days, flexible dates"
     - "Barcelona and Madrid, next month, $2000-$4000"

3. **See Auto-Filled Form**
   - The chatbot extracts information and fills the form automatically
   - You can continue chatting to add more details
   - Or manually adjust any fields

### Example Conversations

**Example 1:**
```
User: "I want to go to Paris and London in March 2024, budget around $3000"

Bot: "Great! I found:
📍 Cities: Paris, London
📅 Dates: 2024-03-01 to 2024-03-31
💰 Budget: $1,500 - $3,000

I've updated the form for you!"
```

**Example 2:**
```
User: "Flexible dates, going to Tokyo and Seoul for 10 days"

Bot: "Great! I found:
📍 Cities: Tokyo, Seoul
📅 Flexible dates
📅 Duration: 10 days

I've updated the form for you!"
```

## Technical Details

### Components

1. **`trip-extractor.ts`** - NLP extraction utility
   - Pattern matching for cities, dates, budget, credit cards
   - Handles various date formats and natural language patterns
   - Validates and normalizes extracted data

2. **`trip-chatbot.tsx`** - Chat UI component
   - Modern, responsive chat interface
   - Real-time message display
   - Typing indicators
   - Auto-scroll to latest message

3. **Integration** - Both setup pages
   - Solo trip setup (`/solo/setup`)
   - Group trip setup (`/group/setup`)
   - Automatically applies extracted data to form fields

### Extraction Patterns

**Cities:**
- "to Paris, London, and Tokyo"
- "visit Barcelona and Madrid"
- "going to New York"
- "destinations: Paris, Rome"

**Dates:**
- "March 15 to March 22, 2024"
- "2024-03-15 to 2024-03-22"
- "from March 15 to March 22"
- "next week"
- "in March 2024"

**Budget:**
- "$1000-$5000"
- "between $2000 and $4000"
- "budget of $3000"
- "$2000 to $4000"

**Duration:**
- "7 days"
- "2 weeks"
- "a month"
- "10-day trip"

## UI/UX Features

- **Floating Chat Button**: Always accessible, bottom-right corner
- **Smooth Animations**: Slide-in/out animations
- **Responsive Design**: Works on all screen sizes
- **Visual Feedback**: Typing indicators, message timestamps
- **Smart Suggestions**: Helpful examples when extraction fails

## Future Enhancements

Potential improvements:
- Integration with AI/LLM for better understanding
- Multi-language support
- Context-aware suggestions
- Learning from user corrections
- Voice input support

## Files Created/Modified

**New Files:**
- `frontend/src/lib/trip-extractor.ts` - Extraction logic
- `frontend/src/components/trip-chatbot.tsx` - Chat UI component

**Modified Files:**
- `frontend/src/app/(app)/solo/setup/page.tsx` - Added chatbot integration
- `frontend/src/app/(app)/group/setup/page.tsx` - Added chatbot integration

## Testing

Test the chatbot with various inputs:

1. **Simple city extraction:**
   - "Paris and London"
   - "I want to visit Tokyo"

2. **Date extraction:**
   - "March 15 to March 22"
   - "next month"
   - "flexible dates"

3. **Budget extraction:**
   - "$2000-$4000"
   - "budget around $3000"

4. **Combined:**
   - "Paris and London in March, $3000 budget"
   - "Tokyo for 7 days, flexible dates"

## Notes

- The chatbot uses pattern matching, not AI/LLM
- Works offline (no API calls needed)
- Fast and responsive
- Can be enhanced with AI integration later
