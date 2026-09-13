/** Runtime configuration only; never part of accepted lesson state or replay. */
export type RuntimeLatencyPolicy = {
  version: "v2-latency-policy-1" | "v2-latency-observation-1";
  observationOnly: boolean;
  freshnessStatus: "hypothesis";
  lanes: {
    Live: {
      providerHardMs: number;
      hostTotalMs: number;
      freshness: {
        firstAnswerMs: number;
        completeMs: number;
        acceptedMs: number;
        visibleMs: number;
      };
    };
    Stage: {
      providerHardMs: number;
      hostTotalMs: number;
      freshness: { completeMs: number; acceptedMs: number };
    };
  };
  attention: { admissionMs: number; publishedTtlMs: number };
};

/** Freshness objectives start at request dispatch and do not reject late useful
 * knowledge. Hard deadlines bound execution; publication starts a separate TTL.
 * Both provider caps match so the HTTP deadline starts before parsing the lane.
 */
export const latencyPolicy: RuntimeLatencyPolicy = {
  version: "v2-latency-policy-1",
  observationOnly: false,
  freshnessStatus: "hypothesis",
  lanes: {
    Live: {
      providerHardMs: 12_000,
      hostTotalMs: 15_000,
      freshness: {
        firstAnswerMs: 5_000,
        completeMs: 7_000,
        acceptedMs: 7_500,
        visibleMs: 8_000,
      },
    },
    Stage: {
      providerHardMs: 12_000,
      hostTotalMs: 15_000,
      freshness: { completeMs: 8_000, acceptedMs: 10_000 },
    },
  },
  attention: { admissionMs: 7_500, publishedTtlMs: 750 },
};
