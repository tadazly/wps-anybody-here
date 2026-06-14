const USER_COLORS = [
    "#4E7FFF",
    "#16A34A",
    "#F59E0B",
    "#8B5CF6",
    "#06B6D4",
    "#EC4899",
    "#84CC16",
    "#F97316",
    "#6366F1",
    "#14B8A6",
];

export function hashString(str: string) {
    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

export function colorFromSeed(seed: string) {
    const hash = hashString(seed);
    return USER_COLORS[hash % USER_COLORS.length];
}
