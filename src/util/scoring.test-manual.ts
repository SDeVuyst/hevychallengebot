/** Quick sanity check for bonus scoring — run with: npx tsx src/util/scoring.test-manual.ts */
import { computeScore } from "../challenges/engine.js";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// 3 exercises, user has tiers 2,2,1 → tierPoints=5, bonus=1 (min depth 1)
{
  const s = computeScore(
    [1, 2, 3],
    [
      { challengeExerciseId: 1, tier: 1 },
      { challengeExerciseId: 1, tier: 2 },
      { challengeExerciseId: 2, tier: 1 },
      { challengeExerciseId: 2, tier: 2 },
      { challengeExerciseId: 3, tier: 1 },
    ],
  );
  assert(s.tierPoints === 5, `tierPoints ${s.tierPoints}`);
  assert(s.bonusPoints === 1, `bonus ${s.bonusPoints}`);
  assert(s.totalPoints === 6, `total ${s.totalPoints}`);
}

// full depth 2 on all → bonus 2
{
  const s = computeScore(
    [1, 2],
    [
      { challengeExerciseId: 1, tier: 1 },
      { challengeExerciseId: 1, tier: 2 },
      { challengeExerciseId: 2, tier: 1 },
      { challengeExerciseId: 2, tier: 2 },
    ],
  );
  assert(s.bonusPoints === 2, `bonus ${s.bonusPoints}`);
  assert(s.tierPoints === 4, `tier ${s.tierPoints}`);
  assert(s.totalPoints === 6, `total ${s.totalPoints}`);
}

console.log("scoring ok");
