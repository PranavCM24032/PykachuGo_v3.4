# Puzzle Linking System - ID-Based Architecture

## Overview
The puzzle linking system uses **puzzle IDs** for "next-puzzle" progression and **single answer values**, making administration easier and creating a cleaner puzzle progression chain.

## Changes Made

### 1. **puzzle.json** Structure Update
**Before (previousPuzzleId):**
```json
{
  "id": 2,
  "answers": ["32"],
  "previousPuzzleAnswers": ["-5"]
}
```

**After (nextPuzzleId):**
```json
{
  "id": 2,
  "answer": "4",
  "nextPuzzleId": [3]
}
```

### 2. Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `answer` | `string` | Single correct answer for this puzzle |
| `nextPuzzleId` | `array` | Array of puzzle IDs that this puzzle **unlocks** when solved |
| `startCode` | `string` | Presence of this field marks a **starting puzzle** (first in the chain) |
| `nextPuzzleId: []` | Empty array | Marks the **final puzzle** (no puzzle follows) |

### 3. Puzzle Progression Chain

```
Puzzle 1 XG01 (startCode: "START", nextPuzzleId: [2]) → Starting puzzle
    ↓ (answer: "-5" unlocks Puzzle 2)
Puzzle 2 XG02 (nextPuzzleId: [3]) → Solved by Puzzle 1's answer
    ↓ (answer: "4" unlocks Puzzle 3)
Puzzle 3 XG03 (nextPuzzleId: [4]) → Solved by Puzzle 2's answer
    ↓ (answer: "13" unlocks Puzzle 4)
Puzzle 4 XG04 (nextPuzzleId: [5]) → Solved by Puzzle 3's answer
    ↓ (answer: "4" unlocks Puzzle 5)
Puzzle 5 XG05 (nextPuzzleId: [6]) → Solved by Puzzle 4's answer
```

### 4. Multiple Next Puzzles (Branching Paths)

You can now have puzzles that unlock **multiple different puzzles**:

```json
{
  "id": 10,
  "answer": "FINAL",
  "nextPuzzleId": [11, 12, 13]
}
```

This means solving Puzzle 10 unlocks **all** of:
- Puzzle 11
- Puzzle 12
- Puzzle 13

## How It Works

### Unlock Validation Logic

1. **Starting Puzzles** (has `startCode`)
   - Enter the `startCode` (e.g. `"START"`) to unlock
   - The **only** puzzle a fresh player can scan/unlock first

2. **Graph / Branching Unlocks** (`nextPuzzleId: [...]`)
   - `nextPuzzleId` is an **edge list**: solving a puzzle unlocks *every* id it lists
   - Because the graph can branch (and even cycle), a puzzle is allowed if it appears in the `nextPuzzleId` of **any already-solved puzzle** (union of unlocked edges), not just the last one solved
   - All branches become accessible at the same time

### Where the branches are shown (Step 5)

When a puzzle is solved:
- **Single branch** (`nextPuzzleId: [N]`) → the next puzzle's `locationClue` is shown as before
- **Multiple branches** (`nextPuzzleId: [A, B]`) → Step 5 shows **every** next location, one row per puzzle (`XG02 → Mechanical Workshop`, `XG06 → M308`), with a `(2)` count on the "NEXT LOCATION" label

### Unlock Queue (per team)

Every team has an **ordered unlock queue** persisted in `localStorage` (`scoreState.<team>.queue`):

- Solving a puzzle pushes **every id** from its `nextPuzzleId` onto the queue (deduped, solved puzzles excluded)
- A puzzle is unlockable **only if** it sits in that queue
- Scanning/QR or deep-linking a puzzle that is NOT in the queue = **jump → blocked**
- Migration: teams saved before queues existed get their queue rebuilt from their solved puzzles' outgoing edges

### Example Flow

**Player solved Puzzle 2, wants to unlock Puzzle 3:**
1. System checks: `Puzzle 2.nextPuzzleId = [3]`
2. Player scans Puzzle 3's QR (or deep link `?linkid=XG03`)
3. Player enters: `"4"` (Puzzle 2's answer)
4. System validates: `"4" === Puzzle 2.answer` ✓
5. **Result:** Puzzle 3 unlocked!

**Player solved Puzzle 1 (graph branch `nextPuzzleId: [2, 6]`):**
1. Queue becomes `[2, 6]`
2. Puzzles **2 AND 6** are both unlocked at once
3. Step 5 shows both locations (`Mechanical Workshop` + `M308`)
4. Player can scan **either** puzzle next
5. Puzzle 3 is **NOT** in the queue yet → scanning XG03 is a jump → blocked until 2 or 6 is solved

## Benefits

### ✅ **Easier Administration**
- Progression defined *forward*: each puzzle declares where the player goes next
- No need to remember/copy answers
- Just reference puzzle IDs: `[2]`, `[3]`, `[4]`
- Single answer value (no array needed)

### ✅ **Cleaner Data Structure**
```json
{
  "answer": "4",             // Single value, not array
  "nextPuzzleId": [3]        // Array for flexibility (multiple unlocks)
}
```

### ✅ **Better Tracking**
- Google Sheets logs show: `"unlockedVia": "Puzzle 2"`
- For multiple: `"unlockedVia": "Puzzle 2"` (the puzzle whose answer was used)
- Clear audit trail of puzzle progression

### ✅ **Flexible Branching**
- Multiple starting puzzles: a `startCode` on more than one puzzle
- Multiple paths forward: `"nextPuzzleId": [5, 6]`

### ✅ **Simpler Answer Handling**
- One answer per puzzle (cleaner)
- No array iteration needed
- Direct string comparison

## Adding New Puzzles

### Starting Puzzle
```json
{
  "id": 10,
  "linkid": "XG10",
  "answer": "NEWSTART",
  "startCode": "GO",
  "nextPuzzleId": [11]
}
```

### Sequential Puzzle
```json
{
  "id": 11,
  "linkid": "XG11",
  "answer": "ANSWER11",
  "nextPuzzleId": [12]
}
```

### Final Puzzle (no next)
```json
{
  "id": 12,
  "linkid": "XG12",
  "answer": "FINAL",
  "nextPuzzleId": []
}
```

### Multiple Next Puzzles (Branching Paths)
```json
{
  "id": 20,
  "linkid": "XG20",
  "answer": "CONVERGENCE",
  "nextPuzzleId": [21, 22, 23]
}
```
*Solving this puzzle unlocks puzzles 21, 22, AND 23*

## Chain Gating

The "chain gate" (`isPuzzleAllowed` in `js/state.js`) prevents teams from jumping ahead:

- Only the **starting puzzle** (`startCode`) is allowed when progress is empty
- Solving a puzzle pushes its `nextPuzzleId` entries onto the team's **unlock queue**
- A puzzle may only be scanned/unlocked if it is in the queue (or already solved)
- Scanning any puzzle outside the queue = jump → blocked

## Migration Notes

- `previousPuzzleId` field → replaced with `nextPuzzleId` (forward declaration of what each puzzle unlocks)
- `[0]` magic value removed → starting puzzles are now marked by a `startCode`
- Old `answers` array → changed to single `answer` string
- Backward compatibility: **NOT maintained** (clean break)
- Google Sheets logging enhanced with `unlockedVia` field

## Testing Checklist

- [ ] Starting puzzle (XG01) accepts the start code
- [ ] Puzzle 2 requires Puzzle 1's answer ("-5")
- [ ] Puzzle 3 requires Puzzle 2's answer ("4")
- [ ] Invalid codes are rejected
- [ ] Skipping ahead (Puzzle 1 → Puzzle 4) is blocked by the chain gate
- [ ] Graph branch: solving XG01 unlocks BOTH XG02 and XG06
- [ ] Step 5 shows all branch locations when `nextPuzzleId` has 2+ ids
- [ ] Google Sheets logs show correct `unlockedVia` data
- [ ] QR code scanning still works
- [ ] Manual entry still works
- [ ] Multiple next-puzzles work (if implemented)

---

**Last Updated:** 2026-09-18
**Version:** 4.0 - Forward-Linked `nextPuzzleId` + `startCode`