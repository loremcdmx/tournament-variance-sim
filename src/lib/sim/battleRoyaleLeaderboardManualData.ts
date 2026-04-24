import type { BattleRoyaleLeaderboardLookupSnapshot } from "./types";

export const BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES = [
  "0.25",
  "1",
  "3",
  "10",
  "25",
] as const;

export type BattleRoyaleLeaderboardManualStake =
  (typeof BATTLE_ROYALE_LEADERBOARD_MANUAL_STAKES)[number];

type RawManualSnapshot = readonly [
  date: string,
  promotionId: number,
  entries: readonly (readonly [rank: number, points: number, prize: number])[],
];

export const BATTLE_ROYALE_LEADERBOARD_MANUAL_SOURCE = {
  groupId: 1328,
  sourceUrl: "https://pml.good-game-service.com/pm-leaderboard/group?groupId=1328&lang=en&timezone=UTC-8",
  timezone: "UTC-8",
  generatedAt: "2026-04-24",
  finishedDateFrom: "2026-04-20",
  finishedDateTo: "2026-04-20",
  snapshotCount: 3,
  tierCount: 124,
  rateLimitNote: "Public API returned Cloudflare 1015 while expanding this seed set; values are only committed for stakes that were fetched completely.",
} as const;

const RAW_MANUAL_SNAPSHOTS = {
  "0.25": [
    ["2026-04-20",207863,[[1,16628,7.5],[2,14772,7],[3,14251,6.25],[4,14152,5.75],[5,12160,5.5],[6,11274,5],[7,10602,4.5],[8,10396,4],[9,9821,3.5],[10,9161,3],[16,5820,2.5],[25,4589,2],[40,3119,1.5],[80,2012,1.25],[120,1622,1],[200,1128,0.75],[220,1016,0.5],[350,714,0.25]]]
  ],
  "1": [
    ["2026-04-20",207833,[[1,13464,20],[2,12111,18],[3,11883,16],[4,11582,16],[5,11380,14],[6,11000,12],[7,10574,12],[8,10533,10],[9,8542,8],[10,8284,8],[11,8230,8],[12,8169,8],[13,6735,6],[14,6682,6],[15,6626,6],[16,6262,6],[17,6198,6],[18,5517,6],[19,5296,5],[20,5283,5],[21,5257,5],[22,5195,5],[23,5082,5],[24,5049,5],[25,4943,5],[26,4721,5],[27,4720,4],[28,4682,4],[29,4647,4],[30,4601,4],[31,4396,4],[32,4333,4],[33,4254,4],[34,4199,4],[35,4192,4],[36,4172,4],[37,4143,4],[38,4137,4],[39,4053,3],[40,4011,3],[50,3614,3],[60,2905,3],[70,2708,3],[80,2522,3],[90,2272,2],[100,2072,2],[110,1948,2],[120,1861,2],[130,1733,1],[140,1617,1],[150,1495,1],[160,1399,1],[170,1310,1],[180,1250,1],[190,1191,1],[200,1134,1],[210,1098,1],[220,1066,1],[230,1031,1],[240,1007,1]]]
  ],
  "3": [

  ],
  "10": [

  ],
  "25": [
    ["2026-04-20",207743,[[1,15435,250],[2,15103,225],[3,12433,200],[4,11172,175],[5,10758,150],[6,8197,125],[7,7879,125],[8,6471,100],[9,6365,75],[10,6241,75],[11,5985,75],[12,5785,75],[13,5271,75],[14,4962,75],[15,4839,50],[16,4817,50],[17,4592,50],[18,4465,50],[19,4186,50],[20,4163,50],[21,4136,50],[22,3959,50],[23,3950,50],[24,3767,50],[25,3742,50],[26,3732,50],[27,3724,50],[28,3671,50],[29,3631,50],[30,3605,50],[31,3572,50],[32,3519,50],[33,3483,50],[34,3462,50],[35,3439,50],[36,3432,50],[37,3374,50],[38,3360,50],[39,3350,50],[40,3350,50],[50,2425,25],[60,1934,25],[70,1671,25],[80,1508,25],[90,1393,25],[100,1280,25]]]
  ]
} satisfies Record<BattleRoyaleLeaderboardManualStake, readonly RawManualSnapshot[]>;

export function getBattleRoyaleLeaderboardManualSnapshots(
  stake: BattleRoyaleLeaderboardManualStake,
): BattleRoyaleLeaderboardLookupSnapshot[] {
  return RAW_MANUAL_SNAPSHOTS[stake].map(([date, promotionId, entries]) => ({
    id: `br-${stake}-${date}`,
    label: `$${stake} ${date}`,
    entries: entries.map(([rank, points, prize]) => ({
      rank,
      points,
      prize,
      nickname: `promotion ${promotionId}`,
    })),
  }));
}
