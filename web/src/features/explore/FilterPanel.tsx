import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { PlumeFilters } from "./filters";

interface FilterPanelProps {
  filters: PlumeFilters;
  places: string[];
  dateSpan: { min: string; max: string } | null;
  activeCount: number;
  onChange: (next: PlumeFilters) => void;
  onClear: () => void;
}

export function FilterPanel({ filters, places, dateSpan, activeCount, onChange, onClear }: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();
  const fromId = useId();
  const toId = useId();
  const placeId = useId();
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };
  // Escape closes the sheet first; preventDefault keeps the plume preview open underneath.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };

  return (
    <div className={open ? "filters filters--open" : "filters"}>
      <button
        ref={toggleRef}
        type="button"
        className="button filters__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Filters
        {activeCount > 0 && (
          <span className="filters__count">
            {activeCount}
            <span className="visually-hidden"> active</span>
          </span>
        )}
      </button>
      {/* Phones: tapping the dimmed map closes the sheet. */}
      <div className="filters__backdrop" aria-hidden="true" onClick={close} />
      <form
        id={panelId}
        className="filters__panel"
        aria-labelledby={titleId}
        onSubmit={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
      >
        <div className="filters__head">
          <h2 id={titleId} className="filters__title">
            Plume filters
          </h2>
          <button type="button" className="button button--small filters__done" onClick={close}>
            Done
          </button>
        </div>
        <div className="filters__dates">
          <label className="field" htmlFor={fromId}>
            <span className="field__label">From</span>
            <input
              id={fromId}
              className="field__input"
              type="date"
              value={filters.from ?? ""}
              min={dateSpan?.min}
              max={filters.to ?? dateSpan?.max}
              onChange={(event) => onChange({ ...filters, from: event.target.value || null })}
            />
          </label>
          <label className="field" htmlFor={toId}>
            <span className="field__label">To</span>
            <input
              id={toId}
              className="field__input"
              type="date"
              value={filters.to ?? ""}
              min={filters.from ?? dateSpan?.min}
              max={dateSpan?.max}
              onChange={(event) => onChange({ ...filters, to: event.target.value || null })}
            />
          </label>
        </div>
        <label className="field" htmlFor={placeId}>
          <span className="field__label">Place</span>
          <select
            id={placeId}
            className="field__input"
            value={filters.place ?? ""}
            onChange={(event) => onChange({ ...filters, place: event.target.value || null })}
          >
            <option value="">All places</option>
            {places.map((place) => (
              <option key={place} value={place}>
                {place}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            className="check__input"
            checked={filters.dryOnly}
            onChange={(event) => onChange({ ...filters, dryOnly: event.target.checked })}
          />
          <span>Dry weather only</span>
        </label>
        {/* Hidden when there is nothing to clear, rather than a greyed-out button. */}
        {activeCount > 0 && (
          <button type="button" className="button button--ghost button--small filters__clear" onClick={onClear}>
            Clear filters
          </button>
        )}
      </form>
    </div>
  );
}
