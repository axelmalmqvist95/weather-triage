import { isPersonLabel, type DetectionInfo, type ItemCategory, type SpaceKind } from '../ontology/schema.ts';

/** Vad Vision faktiskt såg för ett objekt vid tryckögonblicket (ingen bild). */
export interface SeenObject {
  label: string; // COCO-klass
  name: string; // svenskt namn
  score: number; // 0–1
  scene?: string; // lokal scenanalys, t.ex. "Kök"
}

export interface CaptureDraft {
  itemName: string;
  itemCategory: ItemCategory;
  placeKind: SpaceKind;
  placeName: string;
  observationTitle: string;
  detection: DetectionInfo;
  uncertainty: 'låg' | 'medel' | 'hög';
}

export const DETECTOR_MODEL = 'efficientdet_lite0';

const CATEGORY_BY_LABEL: Record<string, ItemCategory> = {
  tv: 'elektronik', laptop: 'elektronik', mouse: 'elektronik', remote: 'elektronik', keyboard: 'elektronik', 'cell phone': 'elektronik', clock: 'elektronik',
  'hair drier': 'elektronik',
  chair: 'möbel', couch: 'möbel', bed: 'möbel', 'dining table': 'möbel', bench: 'möbel',
  bicycle: 'fordon', car: 'fordon', motorcycle: 'fordon', bus: 'fordon', truck: 'fordon', boat: 'fordon', airplane: 'fordon', train: 'fordon',
  scissors: 'verktyg', knife: 'köksutrustning', fork: 'köksutrustning', spoon: 'köksutrustning', bowl: 'köksutrustning', cup: 'köksutrustning',
  'wine glass': 'köksutrustning', bottle: 'förbrukning',
  microwave: 'vitvara', oven: 'vitvara', toaster: 'vitvara', refrigerator: 'vitvara', sink: 'vitvara', toilet: 'vitvara',
  'sports ball': 'sport', skis: 'sport', snowboard: 'sport', skateboard: 'sport', surfboard: 'sport', 'tennis racket': 'sport',
  'baseball bat': 'sport', 'baseball glove': 'sport', frisbee: 'sport', kite: 'sport',
  backpack: 'kläder', handbag: 'kläder', tie: 'kläder', suitcase: 'kläder', umbrella: 'kläder',
  book: 'dokument', 'potted plant': 'växt', vase: 'övrigt', 'teddy bear': 'övrigt', toothbrush: 'förbrukning',
  banana: 'förbrukning', apple: 'förbrukning', sandwich: 'förbrukning', orange: 'förbrukning', broccoli: 'förbrukning', carrot: 'förbrukning',
  'hot dog': 'förbrukning', pizza: 'förbrukning', donut: 'förbrukning', cake: 'förbrukning',
  bird: 'djur', cat: 'djur', dog: 'djur', horse: 'djur', sheep: 'djur', cow: 'djur', elephant: 'djur', bear: 'djur', zebra: 'djur', giraffe: 'djur',
};

const PLACE_BY_SCENE: Record<string, [SpaceKind, string]> = {
  Kök: ['kök', 'Kök'], Sovrum: ['rum', 'Sovrum'], Vardagsrum: ['rum', 'Vardagsrum'], 'Kontor / arbetsplats': ['kontor', 'Kontor'],
  Badrum: ['badrum', 'Badrum'], Matbord: ['rum', 'Matplats'], 'Gata / trafik': ['utomhus', 'Utomhus'], 'Utomhus / natur': ['utomhus', 'Utomhus'],
};

export const itemCategoryFor = (label: string): ItemCategory => CATEGORY_BY_LABEL[label] ?? 'övrigt';

export const uncertaintyOf = (score: number): CaptureDraft['uncertainty'] => (score >= 0.75 ? 'hög' : score >= 0.5 ? 'medel' : 'låg');

/**
 * Bygger ett förslag från det kameran faktiskt identifierade. Returnerar null för personer –
 * personrelaterade detektioner förs aldrig över till Memory.
 */
export function buildCaptureDraft(seen: SeenObject): CaptureDraft | null {
  if (isPersonLabel(seen.label)) return null;
  const [placeKind, placeName] = (seen.scene && PLACE_BY_SCENE[seen.scene]) || ['rum', 'Rum'];
  const score = Math.round(Math.min(1, Math.max(0, seen.score)) * 100) / 100;
  return {
    itemName: seen.name,
    itemCategory: itemCategoryFor(seen.label),
    placeKind,
    placeName,
    observationTitle: `Registrerad: ${seen.name}`,
    detection: { label: seen.label, score, model: DETECTOR_MODEL },
    // "Säkerhet" = modellens egen poäng för klassen – inte ett mått på om föremålet är rätt identifierat individuellt.
    uncertainty: uncertaintyOf(score),
  };
}
