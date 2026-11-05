import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_TRANSITIONS, newId, validate, validateEvent, validateObservation, validateProperty, validateSpace,
  type Observation, type OntologyEvent, type Property, type Space,
} from '../src/ontology/schema.ts';

const T = '2026-01-01T10:00:00.000Z';
const prop = (): Property => ({ type: 'property', id: newId('property'), createdAt: T, updatedAt: T, name: 'Hus', address: 'Gatan 1' });
const space = (propertyId: string): Space => ({ type: 'space', id: newId('space'), createdAt: T, updatedAt: T, propertyId, name: 'Kök', kind: 'kök' });
const obs = (propertyId: string, spaceId: string): Observation => ({
  type: 'observation', id: newId('observation'), createdAt: T, updatedAt: T, propertyId, spaceId, title: 'Läckage',
  category: 'läckage', severity: 3, status: 'öppen', source: 'manuell', observedAt: T,
});

test('newId använder typprefix och är unikt', () => {
  assert.match(newId('property'), /^prop_[0-9a-f-]{36}$/);
  assert.match(newId('event'), /^evt_/);
  assert.notEqual(newId('space'), newId('space'));
});

test('giltiga objekt ger inga fel', () => {
  const p = prop(), s = space(p.id), o = obs(p.id, s.id);
  assert.deepEqual(validateProperty(p), []);
  assert.deepEqual(validateSpace(s), []);
  assert.deepEqual(validateObservation(o), []);
  assert.deepEqual(validate(o), []);
});

test('fastighet: tomt namn, fel id-prefix och orimligt byggår avvisas', () => {
  const p = { ...prop(), id: 'space_x', name: '  ', buildYear: 3000 };
  const issues = validateProperty(p);
  assert.ok(issues.some((i) => i.includes('id')));
  assert.ok(issues.some((i) => i.includes('name')));
  assert.ok(issues.some((i) => i.includes('buildYear')));
});

test('yta: okänd typ, negativ yta och självreferens avvisas', () => {
  const p = prop();
  const s = space(p.id);
  const bad = { ...s, kind: 'slott' as never, areaM2: -5, parentSpaceId: s.id };
  const issues = validateSpace(bad);
  assert.ok(issues.some((i) => i.includes('kind')));
  assert.ok(issues.some((i) => i.includes('areaM2')));
  assert.ok(issues.some((i) => i.includes('sig själv')));
});

test('observation: allvarlighet, konfidens och AI-förslag utan konfidens', () => {
  const p = prop(), s = space(p.id);
  assert.ok(validateObservation({ ...obs(p.id, s.id), severity: 5 as never }).some((i) => i.includes('severity')));
  assert.ok(validateObservation({ ...obs(p.id, s.id), confidence: 1.5 }).some((i) => i.includes('confidence')));
  assert.ok(validateObservation({ ...obs(p.id, s.id), source: 'ai-förslag' }).some((i) => i.includes('AI-förslag')));
  assert.deepEqual(validateObservation({ ...obs(p.id, s.id), source: 'ai-förslag', confidence: 0.7 }), []);
});

test('händelse: aktör måste vara en roll och data enkla värden', () => {
  const p = prop();
  const e: OntologyEvent = {
    type: 'event', id: newId('event'), at: T, kind: 'skapad', subjectType: 'property', subjectId: p.id, propertyId: p.id,
    summary: 'Skapad', actor: 'inspektör', data: { antal: 2 },
  };
  assert.deepEqual(validateEvent(e), []);
  assert.ok(validateEvent({ ...e, actor: 'Anna Andersson' as never }).some((i) => i.includes('actor')));
  assert.ok(validateEvent({ ...e, data: { x: { nested: 1 } as never } }).some((i) => i.includes('enkelt värde')));
  assert.ok(validateEvent({ ...e, subjectType: 'space' }).some((i) => i.includes('subjectId')));
  assert.ok(validateEvent({ ...e, at: '5 november' }).some((i) => i.includes('at')));
});

test('statusövergångar: avvisad kan inte gå direkt till åtgärdad', () => {
  assert.ok(STATUS_TRANSITIONS['öppen'].includes('bekräftad'));
  assert.ok(!STATUS_TRANSITIONS['avvisad'].includes('åtgärdad'));
  assert.ok(!STATUS_TRANSITIONS['öppen'].includes('åtgärdad'));
});
