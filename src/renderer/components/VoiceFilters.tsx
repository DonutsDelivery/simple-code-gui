import React from 'react'
import type { ModelFilter } from './VoiceBrowserTypes.js'

interface VoiceFiltersProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  modelFilter: ModelFilter
  onModelFilterChange: (filter: ModelFilter) => void
  languageFilter: string
  onLanguageFilterChange: (filter: string) => void
  qualityFilter: string
  onQualityFilterChange: (filter: string) => void
  languages: string[]
  qualities: string[]
  onRefresh: () => void
  loading: boolean
}

export function VoiceFilters({
  searchQuery,
  onSearchChange,
  modelFilter,
  onModelFilterChange,
  languageFilter,
  onLanguageFilterChange,
  qualityFilter,
  onQualityFilterChange,
  languages,
  qualities,
  onRefresh,
  loading
}: VoiceFiltersProps): React.ReactElement {
  return (
    <div className="voice-browser-filters">
      <input
        type="text"
        className="voice-search"
        placeholder="Search voices..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        className="voice-filter"
        value={modelFilter}
        onChange={(e) => onModelFilterChange(e.target.value as ModelFilter)}
      >
        <option value="all">All Models</option>
        <option value="piper">Piper</option>
        <option value="xtts">XTTS Clones</option>
      </select>
      <select
        className="voice-filter"
        value={languageFilter}
        onChange={(e) => onLanguageFilterChange(e.target.value)}
      >
        <option value="all">All Languages</option>
        {languages.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>
      <select
        className="voice-filter"
        value={qualityFilter}
        onChange={(e) => onQualityFilterChange(e.target.value)}
      >
        <option value="all">All Quality</option>
        {qualities.map((q) => (
          <option key={q} value={q}>
            {q}
          </option>
        ))}
        <option value="clone">clone</option>
      </select>
      <button
        className="btn-secondary voice-refresh-btn"
        onClick={onRefresh}
        disabled={loading}
        title="Refresh catalog from server"
      >
        Refresh
      </button>
    </div>
  )
}
