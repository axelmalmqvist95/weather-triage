import type { Ontology } from './actions.ts';
import type { ObservationCategory, Severity, SpaceKind } from './schema.ts';

/**
 * Syntetisk testdata för demonstration. Alla fastigheter och adresser är påhittade.
 * Skapas via samma actions som riktig data, så att händelseloggen blir konsekvent.
 * Deterministisk för en given seed (utom slumpade id:n).
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SpaceSpec { name: string; kind: SpaceKind; floor?: number; area?: number; children?: SpaceSpec[] }
interface PropSpec { name: string; address: string; municipality: string; buildYear: number; spaces: SpaceSpec[] }

const PROPERTIES: PropSpec[] = [
  {
    name: 'Brf Testhuset (syntetisk)', address: 'Exempelgatan 1', municipality: 'Fiktiva kommun', buildYear: 1964,
    spaces: [
      { name: 'Trapphus A', kind: 'trapphus', floor: 0 },
      { name: 'Källare', kind: 'källare', floor: -1, area: 120, children: [{ name: 'Tvättstuga', kind: 'tvättstuga', floor: -1, area: 18 }, { name: 'Undercentral', kind: 'teknikrum', floor: -1, area: 9 }] },
      { name: 'Lgh 1101', kind: 'rum', floor: 1, area: 64, children: [{ name: 'Kök 1101', kind: 'kök', floor: 1, area: 9 }, { name: 'Badrum 1101', kind: 'badrum', floor: 1, area: 4 }] },
      { name: 'Vind', kind: 'vind', floor: 4 },
      { name: 'Tak', kind: 'tak' },
      { name: 'Fasad syd', kind: 'fasad' },
    ],
  },
  {
    name: 'Villa Demo (syntetisk)', address: 'Påhittade vägen 12', municipality: 'Exempelby', buildYear: 1978,
    spaces: [
      { name: 'Kök', kind: 'kök', floor: 1, area: 14 },
      { name: 'Badrum övre', kind: 'badrum', floor: 2, area: 6 },
      { name: 'Krypgrund', kind: 'källare', floor: -1 },
      { name: 'Garage', kind: 'garage', floor: 1, area: 22 },
      { name: 'Tomt', kind: 'utomhus' },
    ],
  },
  {
    name: 'Lager Testparken (syntetisk)', address: 'Industrivägen 99', municipality: 'Fiktiva kommun', buildYear: 1991,
    spaces: [
      { name: 'Lagerhall', kind: 'rum', floor: 1, area: 1400 },
      { name: 'Elrum', kind: 'teknikrum', floor: 1, area: 12 },
      { name: 'Kontor', kind: 'rum', floor: 2, area: 80 },
      { name: 'Tak', kind: 'tak' },
    ],
  },
];

const FINDINGS: Partial<Record<SpaceKind, { title: string; category: ObservationCategory; severity: Severity }[]>> = {
  badrum: [
    { title: 'Fuktmärke vid golvbrunn', category: 'fukt', severity: 3 },
    { title: 'Spricka i kakelfog', category: 'spricka', severity: 2 },
    { title: 'Bristande ventilation, kondens i tak', category: 'ventilation', severity: 2 },
  ],
  kök: [
    { title: 'Läckage under diskbänk', category: 'läckage', severity: 3 },
    { title: 'Brandvarnare saknas', category: 'brandskydd', severity: 4 },
  ],
  källare: [
    { title: 'Mögellukt och fläckar på vägg', category: 'mögel', severity: 4 },
    { title: 'Rost på rörupphängning', category: 'rost', severity: 2 },
    { title: 'Fukt i betonggolv', category: 'fukt', severity: 3 },
  ],
  tvättstuga: [{ title: 'Golvbrunn rensas ej', category: 'skada', severity: 2 }],
  teknikrum: [
    { title: 'Elcentral saknar märkning', category: 'el', severity: 2 },
    { title: 'Tryckkärl rostangripet', category: 'rost', severity: 3 },
  ],
  tak: [
    { title: 'Lösa takpannor', category: 'skada', severity: 3 },
    { title: 'Rost på hängränna', category: 'rost', severity: 2 },
  ],
  fasad: [{ title: 'Sättningsspricka i puts', category: 'spricka', severity: 3 }],
  vind: [{ title: 'Fuktfläck på råspont', category: 'fukt', severity: 3 }],
  trapphus: [{ title: 'Nödutgångsskylt släckt', category: 'brandskydd', severity: 3 }],
  garage: [{ title: 'Spricka i garagegolv', category: 'spricka', severity: 1 }],
  utomhus: [{ title: 'Dålig avrinning mot grund', category: 'fukt', severity: 2 }],
  rum: [
    { title: 'Skadad golvmatta', category: 'skada', severity: 1 },
    { title: 'Ventilationsdon igensatt', category: 'ventilation', severity: 2 },
  ],
};

export interface SeedResult { properties: number; spaces: number; observations: number }

export async function seedSyntheticData(ont: Ontology, opts: { seed?: number; base?: Date } = {}): Promise<SeedResult> {
  const rand = rng(opts.seed ?? 42);
  const base = (opts.base ?? new Date()).getTime();
  // Klockan stegas framåt från 60 dagar bakåt så att loggen får en realistisk tidslinje.
  let t = base - 60 * 86400_000;
  const tick = (maxHours: number) => {
    t += Math.round((0.2 + rand() * maxHours) * 3600_000);
    return new Date(Math.min(t, base));
  };
  const prevNow = ont.now;
  const prevActor = ont.actor;
  let props = 0, spaces = 0, observations = 0;

  try {
    for (const ps of PROPERTIES) {
      ont.now = () => tick(6);
      ont.actor = 'system';
      const p = await ont.createProperty({ name: ps.name, address: ps.address, municipality: ps.municipality, buildYear: ps.buildYear });
      props++;
      const created: { id: string; kind: SpaceKind; name: string }[] = [];
      const addSpaces = async (list: SpaceSpec[], parent?: string) => {
        for (const s of list) {
          const sp = await ont.createSpace({ propertyId: p.id, name: s.name, kind: s.kind, floor: s.floor, areaM2: s.area, parentSpaceId: parent });
          spaces++;
          created.push({ id: sp.id, kind: s.kind, name: s.name });
          if (s.children) await addSpaces(s.children, sp.id);
        }
      };
      await addSpaces(ps.spaces);

      // Inspektionstillfälle med observationer
      ont.actor = 'inspektör';
      ont.now = () => tick(48);
      await ont.recordInspection(p.id, `Inspektion genomförd (syntetisk) – ${created.length} ytor`, { ytor: created.length });

      for (const sp of created) {
        for (const f of FINDINGS[sp.kind] ?? []) {
          // Kritiska fynd tas alltid med i demodatan.
          if (rand() < 0.35 && f.severity < 4) continue;
          const ai = rand() < 0.3;
          ont.now = () => tick(3);
          const o = await ont.createObservation({
            spaceId: sp.id, title: f.title, category: f.category, severity: f.severity,
            source: ai ? 'ai-förslag' : 'syntetisk', confidence: ai ? Math.round((0.55 + rand() * 0.4) * 100) / 100 : undefined,
            note: ai ? 'Maskinförslag – kräver bekräftelse.' : undefined,
          });
          observations++;
          // Livscykel: bekräfta/avvisa/åtgärda
          const r = rand();
          if (ai && r < 0.3) {
            await ont.setObservationStatus(o.id, 'avvisad', 'Felaktigt förslag');
          } else if (r < 0.75) {
            await ont.setObservationStatus(o.id, 'bekräftad');
            if (rand() < 0.45 && f.severity < 4) {
              ont.now = () => tick(96);
              await ont.setObservationStatus(o.id, 'åtgärdad', 'Åtgärd utförd');
            }
          }
          if (rand() < 0.2) await ont.addComment('observation', o.id, 'Följs upp vid nästa besiktning.');
        }
      }
    }
  } finally {
    ont.now = prevNow;
    ont.actor = prevActor;
  }
  return { properties: props, spaces, observations };
}
