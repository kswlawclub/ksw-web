import assert from "node:assert/strict";
import test from "node:test";
import { effectiveMatchweek, groupByEffectiveMatchweek, isRescheduledMatch, isSupplementalMatchweek, movedMatchweekCounts } from "./league-matchweek-rescheduling.ts";
test("keeps original weeks while grouping by effective week", () => { const moved={id:"m",originalMatchweek:1,scheduledMatchweek:2}; assert.equal(effectiveMatchweek({id:"a",originalMatchweek:1,scheduledMatchweek:null}),1); assert.equal(effectiveMatchweek(moved),2); assert.equal(groupByEffectiveMatchweek([moved]).get(2)?.[0].originalMatchweek,1); assert.equal(isRescheduledMatch(moved),true); assert.deepEqual(movedMatchweekCounts([moved],1),{movedIn:0,movedOut:1}); assert.equal(isSupplementalMatchweek(8,7),true); });
