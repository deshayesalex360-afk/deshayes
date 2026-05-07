type Plan = "FREE" | "PRO" | "SCALE";

type Features = {
  gpuExportPriority: boolean;
  maxConcurrentExports: number;
  advancedClipAi: boolean;
  realtimeAnalytics: boolean;
  apiAccess: boolean;
  teamWorkspace: boolean;
};

const featureByPlan: Record<Plan, Features> = {
  FREE: {
    gpuExportPriority: false,
    maxConcurrentExports: 1,
    advancedClipAi: false,
    realtimeAnalytics: false,
    apiAccess: false,
    teamWorkspace: false,
  },
  PRO: {
    gpuExportPriority: true,
    maxConcurrentExports: 3,
    advancedClipAi: true,
    realtimeAnalytics: true,
    apiAccess: true,
    teamWorkspace: false,
  },
  SCALE: {
    gpuExportPriority: true,
    maxConcurrentExports: 20,
    advancedClipAi: true,
    realtimeAnalytics: true,
    apiAccess: true,
    teamWorkspace: true,
  },
};

export function getFeaturesForPlan(plan: Plan): Features {
  return featureByPlan[plan];
}
