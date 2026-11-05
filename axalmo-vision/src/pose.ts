import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export type Delegate = 'GPU' | 'CPU';
const BASE = import.meta.env.BASE_URL;

/** Laddar Pose Landmarker från egna filer (ingen CDN). Försöker GPU först, sedan CPU. */
export async function createPoseLandmarker(numPoses: number): Promise<{ landmarker: PoseLandmarker; delegate: Delegate }> {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe`);
  let lastErr: unknown;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      return { landmarker, delegate };
    } catch (e) {
      lastErr = e;
      console.warn(`[pose] ${delegate} misslyckades`, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Kunde inte ladda modellen');
}

export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
