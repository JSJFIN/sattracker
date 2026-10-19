import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Radio } from 'lucide-react';
import type { HistorySummary, SimulationClock } from '../shared/types';

const dateValue = (time: number) => new Date(time).toISOString().slice(0, 19);
export default function Timeline({
  summary,
  error,
  time,
  liveTime,
  replay,
  onSeek,
  onRate,
  onLive,
}: {
  summary: HistorySummary | null;
  error: string;
  time: number;
  liveTime: number;
  replay: SimulationClock | null;
  onSeek: (time: number, rate?: number) => void;
  onRate: (rate: number) => void;
  onLive: () => void;
}) {
  const [draft, setDraft] = useState(dateValue(time));
  const [editing, setEditing] = useState(false);
  const [speed, setSpeed] = useState(() => replay?.rate || 1);
  useEffect(() => {
    if (replay?.rate) setSpeed(replay.rate);
  }, [replay?.rate]);
  useEffect(() => {
    if (!editing) setDraft(dateValue(time));
  }, [time, editing]);
  const start = summary?.start;
  const available = start !== null && start !== undefined && liveTime > start;
  const seek = (next: number) => {
    if (available) onSeek(Math.min(liveTime, Math.max(start, next)));
  };
  return (
    <section
      className="time-controls"
      id="history-playback"
      aria-label="Satellite history playback"
    >
      <div className="timeline-heading">
        <strong>{replay ? 'HISTORY REPLAY' : 'SAVED HISTORY'}</strong>
        <span>
          {summary
            ? summary.satellites.reduce((sum, item) => sum + item.snapshots, 0)
            : '…'}{' '}
          saved snapshots
        </span>
        <button className={replay ? '' : 'is-live'} onClick={onLive}>
          <Radio size={12} />
          Return to live
        </button>
      </div>
      {error ? (
        <p className="timeline-message">{error}</p>
      ) : !available ? (
        <p className="timeline-message">
          History starts with the first N2YO fetch. Saved satellites will appear
          here automatically.
        </p>
      ) : (
        <>
          <form
            className="timeline-date"
            onSubmit={(event) => {
              event.preventDefault();
              const selected = Date.parse(`${draft}Z`);
              if (Number.isFinite(selected)) {
                seek(selected);
                setEditing(false);
              }
            }}
          >
            <label htmlFor="replay-date">UTC</label>
            <input
              id="replay-date"
              aria-label="Replay date and time in UTC"
              type="datetime-local"
              step="1"
              min={dateValue(start)}
              max={dateValue(liveTime)}
              value={draft}
              onFocus={() => setEditing(true)}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit">
              Go <ChevronRight size={12} />
            </button>
          </form>
          <input
            className="timeline-range"
            aria-label="Rewind satellite history"
            type="range"
            min={start}
            max={liveTime}
            step="1"
            value={Math.min(liveTime, Math.max(start, time))}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <div className="timeline-actions">
            <span>
              {new Date(start).toLocaleString('en-GB', {
                timeZone: 'UTC',
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}{' '}
              UTC
            </span>
            <div>
              <button
                title="Rewind one minute"
                aria-label="Rewind one minute"
                onClick={() => seek(time - 60000)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                aria-label={
                  replay?.rate ? 'Pause history playback' : 'Play history'
                }
                onClick={() => {
                  if (!replay) {
                    onSeek(start, speed);
                  } else onRate(replay.rate ? 0 : speed);
                }}
              >
                {replay?.rate ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                title="Forward one minute"
                aria-label="Forward one minute"
                onClick={() => seek(time + 60000)}
              >
                <ChevronRight size={15} />
              </button>
              <select
                aria-label="History playback speed"
                value={speed}
                onChange={(event) => {
                  const rate = Number(event.target.value);
                  setSpeed(rate);
                  if (replay?.rate) onRate(rate);
                }}
              >
                {[-60, -10, -1, 1, 10, 60].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </div>
            <span>NOW</span>
          </div>
          <p className="timeline-caption">
            Positions are reconstructed from the elements saved at that time.
            Earlier, unrecorded satellites are hidden.
          </p>
        </>
      )}
    </section>
  );
}
