import type { SatRec } from 'satellite.js';
import { parseElements, stateAt, orbitAt } from '../shared/orbits';
import type { WorkerInput, WorkerOutput } from '../shared/types';

const context = self as unknown as DedicatedWorkerGlobalScope;
let records: { id: number; record: SatRec }[] = [];
let lastPaths = 0;
const send = (message: WorkerOutput) => context.postMessage(message);
context.onmessage = (event: MessageEvent<WorkerInput>) => {
  const message = event.data;
  if (message.type === 'elements') {
    records = message.elements.map((elements) => ({
      id: elements.id,
      record: parseElements(elements),
    }));
    lastPaths = 0;
  }
  const states = [];
  const futureStates = [];
  const until = message.time + message.rate * 1000;
  const failed: number[] = [];
  for (const { id, record } of records) {
    const state = stateAt(id, record, message.time);
    if (state) {
      states.push(state);
      const future = stateAt(id, record, until);
      if (future) futureStates.push(future);
    } else failed.push(id);
  }
  send({
    type: 'states',
    time: message.time,
    until,
    states,
    futureStates,
    failed,
  });
  if (Math.abs(message.time - lastPaths) > 60000) {
    send({
      type: 'paths',
      paths: records.map(({ id, record }) => orbitAt(id, record, message.time)),
    });
    lastPaths = message.time;
  }
};
