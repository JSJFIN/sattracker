import { Ruler } from 'lucide-react';
import type { OrbitalElements, SatelliteSelection } from '../shared/types';
import type { DistancePair, DistanceReading } from '../shared/distance';

interface Props {
  enabled: boolean;
  pair: DistancePair;
  reading: DistanceReading | null;
  selections: SatelliteSelection[];
  elements: OrbitalElements[];
  name: (id: number) => string;
  showLine: boolean;
  onToggle: () => void;
  onPair: (pair: DistancePair) => void;
  onShowLine: (show: boolean) => void;
}

const utc = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  dateStyle: 'medium',
  timeStyle: 'medium',
  hour12: false,
});

export default function DistanceTool({
  enabled,
  pair,
  reading,
  selections,
  elements,
  name,
  showLine,
  onToggle,
  onPair,
  onShowLine,
}: Props) {
  const hiddenEndpoint = pair.some(
    (id) =>
      !selections.some((satellite) => satellite.id === id && satellite.visible),
  );
  return (
    <div className="distance-tool">
      <button
        className={`distance-toggle ${enabled ? 'active' : ''}`}
        disabled={!enabled && selections.length < 2}
        onClick={onToggle}
        aria-expanded={enabled}
        aria-controls="satellite-distance"
      >
        <Ruler size={15} /> {enabled ? 'Stop measuring' : 'Measure distance'}
      </button>
      {selections.length < 2 && !enabled && (
        <small>Add two satellites to measure their separation.</small>
      )}
      {enabled && (
        <fieldset id="satellite-distance">
          <legend>Satellite distance</legend>
          {(['A', 'B'] as const).map((label, index) => (
            <label className="distance-endpoint" key={label}>
              <span>Satellite {label}</span>
              <select
                id={`distance-satellite-${label.toLowerCase()}`}
                value={pair[index] ?? ''}
                onChange={(event) => {
                  const next: DistancePair = [...pair];
                  next[index] = event.target.value
                    ? Number(event.target.value)
                    : null;
                  onPair(next);
                }}
              >
                <option value="">Choose satellite…</option>
                {selections.map((satellite) => (
                  <option
                    key={satellite.id}
                    value={satellite.id}
                    disabled={satellite.id === pair[1 - index]}
                  >
                    {name(satellite.id)} · #{satellite.id}
                    {satellite.visible ? '' : ' (hidden)'}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <output
            className="distance-value"
            htmlFor="distance-satellite-a distance-satellite-b"
            aria-label="Straight-line satellite distance"
            aria-live="off"
          >
            {reading ? (
              <>
                {reading.kilometers.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span> km</span>
              </>
            ) : (
              '—'
            )}
          </output>
          <small>Predicted straight-line separation in 3D.</small>
          {reading && (
            <small>
              At{' '}
              <time dateTime={new Date(reading.time).toISOString()}>
                {utc.format(reading.time)} UTC
              </time>
            </small>
          )}
          <dl className="distance-altitude">
            <dt>Altitude difference</dt>
            <dd>
              <output
                htmlFor="distance-satellite-a distance-satellite-b"
                aria-label="Satellite altitude difference"
                aria-live="off"
              >
                {reading
                  ? `${Math.abs(reading.altitudeDeltaKm).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
                  : '—'}
              </output>
            </dd>
          </dl>
          {reading && (
            <small>
              {Math.abs(reading.altitudeDeltaKm) < 0.005
                ? 'Same altitude to displayed precision.'
                : reading.altitudeDeltaKm > 0
                  ? 'Satellite B is higher than A.'
                  : 'Satellite A is higher than B.'}
            </small>
          )}
          <p className="distance-status" role="status">
            {pair.some((id) => id === null)
              ? 'Choose two different satellites.'
              : !reading
                ? 'Positions unavailable at this time.'
                : reading.earthBlocked
                  ? 'Earth blocks the line of sight.'
                  : 'Clear line of sight above Earth.'}
          </p>
          <label className="distance-line-toggle">
            <input
              type="checkbox"
              checked={showLine}
              onChange={(event) => onShowLine(event.target.checked)}
            />{' '}
            Show connection
          </label>
          {showLine && hiddenEndpoint && pair.every((id) => id !== null) && (
            <small>Show both satellites to see the connection.</small>
          )}
          <details className="distance-orbit-data">
            <summary>Orbit data</summary>
            <dl>
              {(['A', 'B'] as const).map((label, index) => {
                const element = elements.find(
                  (item) => item.id === pair[index],
                );
                return (
                  <div key={label}>
                    <dt>{label} orbit epoch (UTC)</dt>
                    <dd>
                      {element ? utc.format(element.epoch) : 'Unavailable'}
                    </dd>
                    <dt>{label} fetched (UTC)</dt>
                    <dd>
                      {element ? utc.format(element.fetchedAt) : 'Unavailable'}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <small>
              Orbit predictions can miss maneuvers. Meter-scale close approaches
              need more precise tracking data.
            </small>
          </details>
        </fieldset>
      )}
    </div>
  );
}
