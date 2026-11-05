import { useEffect, useMemo, useState } from 'react';
import { openStore, type OntologyStore } from '../ontology/store.ts';
import { Ontology, type CaptureInput } from '../ontology/actions.ts';
import {
  ITEM_CATEGORIES, OBSERVATION_CATEGORIES, SPACE_KINDS, WORKSPACE_KINDS, workspaceKind,
  type Item, type ItemCategory, type ObservationCategory, type Property, type Space, type SpaceKind, type WorkspaceKind,
} from '../ontology/schema.ts';
import { buildCaptureDraft, type SeenObject } from './capture.ts';

const NEW = '__new__';
const NONE = '__none__';
const LAST_WS = 'axalmo-memory-last-workspace';

/**
 * CAPTURE: förslag från det kameran såg → användaren granskar och rättar → sparas först vid "Spara i minnet".
 * Ingen bild sparas. Personer kan inte sparas (förslaget byggs aldrig för personetiketter).
 */
export default function CaptureSheet({ seen, onClose }: { seen: SeenObject; onClose: () => void }) {
  const draft = useMemo(() => buildCaptureDraft(seen), [seen]);
  const [store, setStore] = useState<OntologyStore | null>(null);
  const [ws, setWs] = useState<Property[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  // Formulär
  const [wsId, setWsId] = useState(NEW);
  const [wsName, setWsName] = useState('Hemma');
  const [wsKind, setWsKind] = useState<WorkspaceKind>('hem');
  const [placeId, setPlaceId] = useState(NEW);
  const [placeName, setPlaceName] = useState(draft?.placeName ?? 'Rum');
  const [placeKind, setPlaceKind] = useState<SpaceKind>(draft?.placeKind ?? 'rum');
  const [itemId, setItemId] = useState(NEW);
  const [itemName, setItemName] = useState(draft?.itemName ?? '');
  const [itemCat, setItemCat] = useState<ItemCategory>(draft?.itemCategory ?? 'övrigt');
  const [title, setTitle] = useState(draft?.observationTitle ?? '');
  const [obsCat, setObsCat] = useState<ObservationCategory>('inventering');
  const [note, setNote] = useState('');

  useEffect(() => {
    let s: OntologyStore | null = null;
    openStore()
      .then(async (st) => {
        s = st;
        setStore(st);
        const [p, sp, it] = await Promise.all([st.all('property'), st.all('space'), st.all('item')]);
        setWs(p);
        setSpaces(sp);
        setItems(it);
        let last: string | null = null;
        try { last = localStorage.getItem(LAST_WS); } catch { /* privat läge */ }
        const pick = p.find((x) => x.id === last) ?? p.find((x) => workspaceKind(x) !== 'fastighet') ?? p[0];
        if (pick) setWsId(pick.id);
      })
      .catch((e) => setError(`Kunde inte öppna minnet: ${(e as Error).message}`));
    return () => s?.close();
  }, []);

  // Förval av plats/föremål när arbetsytan ändras
  const wsSpaces = spaces.filter((s) => s.propertyId === wsId);
  const wsItems = items.filter((i) => i.propertyId === wsId).sort((a, b) => Number(b.category === itemCat) - Number(a.category === itemCat));
  useEffect(() => {
    const match = wsSpaces.find((s) => s.name.toLowerCase() === placeName.toLowerCase());
    setPlaceId(match ? match.id : NEW);
    const sameName = wsItems.find((i) => i.name.toLowerCase() === (draft?.itemName ?? '').toLowerCase());
    setItemId(sameName ? sameName.id : NEW);
  }, [wsId, spaces.length, items.length]);

  if (!draft) {
    return (
      <div className="capture-sheet" role="dialog" aria-label="Spara i minnet">
        <p>Personer kan inte sparas i minnet.</p>
        <button className="btn" onClick={onClose}>Stäng</button>
      </div>
    );
  }

  const save = async () => {
    if (!store) return;
    setSaving(true);
    setError(null);
    try {
      const input: CaptureInput = {
        workspace: wsId === NEW ? { new: { name: wsName.trim(), kind: wsKind } } : { id: wsId },
        place: placeId === NONE ? undefined : placeId === NEW ? { new: { name: placeName.trim(), kind: placeKind } } : { id: placeId },
        item: itemId === NEW ? { new: { name: itemName.trim(), category: itemCat } } : { id: itemId },
        observation: { title: title.trim(), category: obsCat, note: note.trim() || undefined },
        detection: draft.detection,
      };
      const r = await new Ontology(store).capture(input);
      try { localStorage.setItem(LAST_WS, r.workspace.id); } catch { /* ignorera */ }
      setSaved(`${r.item.name} sparad i ${r.workspace.name}${r.place ? ` › ${r.place.name}` : ''}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="capture-sheet" role="dialog" aria-label="Sparat">
        <h3>✓ Sparat i minnet</h3>
        <p>{saved}</p>
        <div className="capture-actions">
          <button className="btn primary" onClick={onClose}>Fortsätt</button>
          <a className="btn" href="#/intelligence/minne">Visa i Minne</a>
        </div>
      </div>
    );
  }

  const valid = title.trim() && (itemId !== NEW || itemName.trim()) && (wsId !== NEW || wsName.trim()) && (placeId !== NEW || placeName.trim());

  return (
    <div className="capture-sheet" role="dialog" aria-label="Spara i minnet" onPointerDown={(e) => e.stopPropagation()}>
      <div className="capture-head">
        <h3>Spara i minnet</h3>
        <button onClick={onClose} aria-label="Avbryt">✕</button>
      </div>
      <p className="capture-seen">
        Kameran såg: <b>{seen.name}</b> · {Math.round(draft.detection.score * 100)} % ({draft.uncertainty} säkerhet) · {draft.detection.model}.
        <br />Ingen bild sparas. Kontrollera och rätta innan du sparar.
      </p>

      <label>Arbetsyta
        <select value={wsId} onChange={(e) => setWsId(e.target.value)}>
          {ws.map((p) => <option key={p.id} value={p.id}>{p.name} ({workspaceKind(p)})</option>)}
          <option value={NEW}>+ Ny arbetsyta</option>
        </select>
      </label>
      {wsId === NEW && (
        <div className="capture-row">
          <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Namn, t.ex. Hemma" aria-label="Arbetsytans namn" />
          <select value={wsKind} onChange={(e) => setWsKind(e.target.value as WorkspaceKind)} aria-label="Typ av arbetsyta">
            {WORKSPACE_KINDS.filter((k) => k !== 'fastighet').map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      )}

      <label>Plats
        <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {wsId !== NEW && wsSpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={NEW}>+ Ny plats</option>
          <option value={NONE}>Ingen plats</option>
        </select>
      </label>
      {placeId === NEW && (
        <div className="capture-row">
          <input value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="t.ex. Förråd" aria-label="Platsens namn" />
          <select value={placeKind} onChange={(e) => setPlaceKind(e.target.value as SpaceKind)} aria-label="Typ av plats">
            {SPACE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      )}

      <label>Föremål
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value={NEW}>+ Nytt föremål</option>
          {wsId !== NEW && wsItems.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.category})</option>)}
        </select>
      </label>
      {itemId === NEW && (
        <div className="capture-row">
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Namn" aria-label="Föremålets namn" />
          <select value={itemCat} onChange={(e) => setItemCat(e.target.value as ItemCategory)} aria-label="Kategori">
            {ITEM_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      )}

      <label>Observation
        <div className="capture-row">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Rubrik" />
          <select value={obsCat} onChange={(e) => setObsCat(e.target.value as ObservationCategory)} aria-label="Typ av observation">
            {OBSERVATION_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </label>
      <label>Anteckning (valfri)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="t.ex. skick, var laddaren finns…" />
      </label>

      {error && <p className="capture-error" role="alert">{error}</p>}
      <div className="capture-actions">
        <button className="btn primary" disabled={!store || saving || !valid} onClick={save}>{saving ? 'Sparar…' : 'Spara i minnet'}</button>
        <button className="btn" onClick={onClose}>Avbryt</button>
      </div>
    </div>
  );
}
