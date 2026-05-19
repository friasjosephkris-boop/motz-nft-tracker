// XP needed to advance from level N to level N+1.
// XP_TABLE[0] = 1→2, XP_TABLE[N-1] = N → N+1. Cap at level MAX_LEVEL.
//
// New curve (dev build update): extended from 30 → 99 levels. Values are
// derived from per-level cumulative XP thresholds provided by design.
// Server mirror lives in api/_lib/progressVault.ts — keep BOTH in sync.
export const XP_TABLE = [
  10,        // 1 → 2
  22,        // 2 → 3
  42,        // 3 → 4
  72,        // 4 → 5
  114,       // 5 → 6
  170,       // 6 → 7
  242,       // 7 → 8
  332,       // 8 → 9
  442,       // 9 → 10
  574,       // 10 → 11
  704,       // 11 → 12
  862,       // 12 → 13
  1038,      // 13 → 14
  1220,      // 14 → 15
  1386,      // 15 → 16
  1566,      // 16 → 17
  1760,      // 17 → 18
  1976,      // 18 → 19
  2196,      // 19 → 20
  2438,      // 20 → 21
  2698,      // 21 → 22
  2976,      // 22 → 23
  3274,      // 23 → 24
  3592,      // 24 → 25
  3932,      // 25 → 26
  4294,      // 26 → 27
  4678,      // 27 → 28
  5086,      // 28 → 29
  5518,      // 29 → 30
  5976,      // 30 → 31
  6460,      // 31 → 32
  6972,      // 32 → 33
  7512,      // 33 → 34
  8082,      // 34 → 35
  8682,      // 35 → 36
  9314,      // 36 → 37
  9978,      // 37 → 38
  10676,     // 38 → 39
  11042,     // 39 → 40
  11744,     // 40 → 41
  12482,     // 41 → 42
  13256,     // 42 → 43
  14068,     // 43 → 44
  14918,     // 44 → 45
  15808,     // 45 → 46
  16738,     // 46 → 47
  17710,     // 47 → 48
  18724,     // 48 → 49
  19782,     // 49 → 50
  20884,     // 50 → 51
  22032,     // 51 → 52
  23226,     // 52 → 53
  24468,     // 53 → 54
  25758,     // 54 → 55
  27098,     // 55 → 56
  28488,     // 56 → 57
  29930,     // 57 → 58
  31424,     // 58 → 59
  32972,     // 59 → 60
  34576,     // 60 → 61
  36236,     // 61 → 62
  37954,     // 62 → 63
  39732,     // 63 → 64
  41756,     // 64 → 65
  43694,     // 65 → 66
  45692,     // 66 → 67
  47752,     // 67 → 68
  49874,     // 68 → 69
  52060,     // 69 → 70
  54310,     // 70 → 71
  56626,     // 71 → 72
  59008,     // 72 → 73
  61458,     // 73 → 74
  63976,     // 74 → 75
  66564,     // 75 → 76
  69222,     // 76 → 77
  71952,     // 77 → 78
  74754,     // 78 → 79
  77630,     // 79 → 80
  80580,     // 80 → 81
  83606,     // 81 → 82
  86708,     // 82 → 83
  89888,     // 83 → 84
  93148,     // 84 → 85
  96488,     // 85 → 86
  99910,     // 86 → 87
  103414,    // 87 → 88
  108708,    // 88 → 89
  112714,    // 89 → 90
  116810,    // 90 → 91
  120996,    // 91 → 92
  143626,    // 92 → 93
  196536,    // 93 → 94
  303428,    // 94 → 95
  502746,    // 95 → 96
  863944,    // 96 → 97
  1498426,   // 97 → 98
  3156518,   // 98 → 99
];
export const MAX_LEVEL = 99;

export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  return XP_TABLE[level - 1];
}

// Apply XP and resolve level-ups in-place. Returns the number of levels gained.
export function awardXp(unit: { level: number; xp: number }, amount: number): number {
  if (unit.level >= MAX_LEVEL) return 0;
  unit.xp += amount;
  let gained = 0;
  while (unit.level < MAX_LEVEL && unit.xp >= xpToNext(unit.level)) {
    unit.xp -= xpToNext(unit.level);
    unit.level += 1;
    gained += 1;
  }
  if (unit.level >= MAX_LEVEL) unit.xp = 0;
  return gained;
}
