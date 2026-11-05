import { FilesetResolver, ObjectDetector, PoseLandmarker } from '@mediapipe/tasks-vision';

export type Delegate = 'GPU' | 'CPU';
export type ModelVariant = 'lite' | 'full';
const BASE = import.meta.env.BASE_URL;

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
const getFileset = () => (fileset ??= FilesetResolver.forVisionTasks(`${BASE}mediapipe`));

/** Provar önskad delegat först, sedan den andra. Returnerar vilken som faktiskt används. */
async function withFallback<T>(preferred: Delegate, make: (d: Delegate) => Promise<T>) {
  let lastErr: unknown;
  for (const d of preferred === 'GPU' ? (['GPU', 'CPU'] as const) : (['CPU', 'GPU'] as const)) {
    try {
      return { model: await make(d), delegate: d };
    } catch (e) {
      lastErr = e;
      console.warn(`[vision] ${d} misslyckades`, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Kunde inte ladda modellen');
}

/** Objektdetektor (EfficientDet-Lite0, 80 COCO-klasser). Allt körs lokalt. */
export async function createDetector(preferred: Delegate) {
  const fs = await getFileset();
  return withFallback(preferred, (delegate) =>
    ObjectDetector.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${BASE}models/efficientdet_lite0.tflite`, delegate },
      runningMode: 'VIDEO',
      maxResults: 12,
      scoreThreshold: 0.4,
    }),
  );
}

/** Pose Landmarker för skelett på personer. */
export async function createPose(numPoses: number, preferred: Delegate, variant: ModelVariant) {
  const fs = await getFileset();
  return withFallback(preferred, (delegate) =>
    PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_${variant}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    }),
  );
}

export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;
