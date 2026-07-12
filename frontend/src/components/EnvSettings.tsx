// src/components/EnvSettings.tsx
// Environment Settings panel — manage API keys, provider URLs, and toggles
// stored in the PostgreSQL env_settings table.

import React, { useEffect, useState, useCallback } from 'react';
import {
  Save, RefreshCw, Eye, EyeOff, CheckCircle2, AlertCircle,
  Cpu, Cloud, Zap, SlidersHorizontal, ChevronDown, ChevronUp,
  Database, FileText, Loader2, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';

const API = 'http://localhost:3000';


// ── Types ─────────────────────────────────────────────────────────────────────

interface EnvEntry {
  key: string;
  value: string;       // masked for secrets
  rawValue: string;    // actual value for inputs
  masked: boolean;
  updated_at: string;
}

interface ProviderSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  enabledKey: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'url';
  placeholder?: string;
  hint?: string;
}

// ── Provider definitions ──────────────────────────────────────────────────────

const PROVIDERS: ProviderSection[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    icon: <Cpu className="w-4 h-4" />,
    color: 'text-blue-400',
    enabledKey: 'OLLAMA_ENABLED',
    fields: [
      { key: 'OLLAMA_BASE_URL', label: 'Base URL', type: 'url', placeholder: 'http://localhost:11434/v1', hint: 'OpenAI-compatible endpoint' },
      { key: 'OLLAMA_MODEL',    label: 'Default Model', type: 'text', placeholder: 'qwen2.5:7b' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    icon: <Zap className="w-4 h-4" />,
    color: 'text-orange-400',
    enabledKey: 'GROQ_ENABLED',
    fields: [
      { key: 'GROQ_API_KEY',  label: 'API Key',  type: 'password', placeholder: 'gsk_…', hint: 'Get free key at console.groq.com' },
      { key: 'GROQ_BASE_URL', label: 'Base URL', type: 'url',      placeholder: 'https://api.groq.com/openai/v1' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    icon: <Cloud className="w-4 h-4" />,
    color: 'text-emerald-400',
    enabledKey: 'OPENAI_ENABLED',
    fields: [
      { key: 'OPENAI_API_KEY',  label: 'API Key',  type: 'password', placeholder: 'sk-…', hint: 'Get key at platform.openai.com' },
      { key: 'OPENAI_BASE_URL', label: 'Base URL', type: 'url',      placeholder: 'https://api.openai.com/v1', hint: 'Change for Azure / proxies' },
    ],
  },
];

const ADVANCED_FIELDS: FieldDef[] = [
  { key: 'MAX_STEPS',             label: 'Max Agent Steps',        type: 'number', placeholder: '100',                   hint: 'Max tool calls per run' },
  { key: 'MAX_TOOL_RESULT_CHARS', label: 'Max Tool Result Chars',  type: 'number', placeholder: '3000',                  hint: 'Truncation limit for tool output' },
  { key: 'CLOAKBROWSER_API_URL',  label: 'Browser API URL',        type: 'url',    placeholder: 'http://localhost:9000', hint: 'CloakBrowser / Puppeteer endpoint' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = `w-full bg-[#0A0F1E] border border-border-dark/60 rounded-lg px-3 py-2 text-xs text-text-main
  placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40
  transition-all font-mono`;

// ── Sub-components ────────────────────────────────────────────────────────────

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${checked ? 'text-emerald-400' : 'text-text-muted'}`}
  >
    {checked
      ? <ToggleRight className="w-5 h-5 text-emerald-400" />
      : <ToggleLeft  className="w-5 h-5 text-text-muted/50" />}
    {checked ? 'Enabled' : 'Disabled'}
  </button>
);

const SecretInput: React.FC<{
  value: string; onChange: (v: string) => void; placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls + ' pr-9'}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted/50 hover:text-text-muted transition-colors"
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

// ── Provider Card ─────────────────────────────────────────────────────────────

const ProviderCard: React.FC<{
  provider: ProviderSection;
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}> = ({ provider, values, onChange }) => {
  const [open, setOpen] = useState(true);
  const enabled = values[provider.enabledKey] !== 'false';

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      enabled ? 'border-border-dark/60 bg-card/10' : 'border-border-dark/30 bg-card/5 opacity-60'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-dark/30 bg-[#0F172A]/50">
        <span className={provider.color}>{provider.icon}</span>
        <span className="text-sm font-bold text-text-main flex-1">{provider.label}</span>
        <ToggleSwitch
          checked={enabled}
          onChange={v => onChange(provider.enabledKey, v ? 'true' : 'false')}
        />
        <button
          onClick={() => setOpen(o => !o)}
          className="text-text-muted/50 hover:text-text-muted transition-colors ml-2"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Fields */}
      {open && (
        <div className="p-4 space-y-3">
          {provider.fields.map(field => (
            <div key={field.key} className="space-y-1">
              <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                {field.label}
              </label>
              {field.type === 'password' ? (
                <SecretInput
                  value={values[field.key] ?? ''}
                  onChange={v => onChange(field.key, v)}
                  placeholder={field.placeholder}
                />
              ) : (
                <input
                  type={field.type}
                  value={values[field.key] ?? ''}
                  onChange={e => onChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className={inputCls}
                />
              )}
              {field.hint && (
                <p className="text-[10px] text-text-muted/60">{field.hint}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const EnvSettings: React.FC = () => {
  const { fetchModels } = useChatStore();

  const [source, setSource]       = useState<'env' | 'db'>('env');
  const [values, setValues]       = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState<{ ok: boolean; msg: string } | null>(null);
  const [dotenvKeys, setDotenvKeys] = useState<string[]>([]);
  const [advOpen, setAdvOpen]     = useState(false);


  // Load settings from backend
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, sourceRes, dotenvRes] = await Promise.all([
        fetch(`${API}/env/settings`),
        fetch(`${API}/env/source`),
        fetch(`${API}/env/dotenv`),
      ]);
      const settings: EnvEntry[] = await settingsRes.json();
      const { source: src }      = await sourceRes.json();
      const dotenv               = await dotenvRes.json();

      setSource(src ?? 'env');
      setDotenvKeys(dotenv.keys ?? []);

      const map: Record<string, string> = {};
      for (const s of settings) map[s.key] = s.rawValue;
      setValues(map);
    } catch (err) {
      showToast(false, 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleChange = (key: string, val: string) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const handleSourceChange = async (newSource: 'env' | 'db') => {
    try {
      await fetch(`${API}/env/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newSource }),
      });
      setSource(newSource);
      showToast(true, `Source switched to "${newSource}"`);
      // Refresh model list so disabled providers disappear immediately
      await fetchModels();
    } catch {
      showToast(false, 'Failed to switch source');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(values).map(([key, value]) => ({ key, value }));
      const res = await fetch(`${API}/env/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast(true, 'Settings saved to database');
      // Refresh model list so enabled/disabled state is reflected immediately
      await fetchModels();
    } catch (err: any) {
      showToast(false, err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-text-muted text-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading environment settings…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h4 className="text-sm font-bold text-text-main font-heading mb-1">Environment Settings</h4>
        <p className="text-xs text-text-muted leading-relaxed">
          Configure API keys, provider URLs, and agent parameters. Save to DB, then switch source to
          activate — no restart needed.
        </p>
      </div>

      {/* Source toggle */}
      <div className="bg-[#0F172A]/60 border border-border-dark/60 rounded-xl p-4 space-y-3">
        <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Config Source</div>
        <div className="flex gap-3">
          {(['env', 'db'] as const).map(s => (
            <button
              key={s}
              onClick={() => handleSourceChange(s)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold border transition-all ${
                source === s
                  ? s === 'db'
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                    : 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-card/30 border-border-dark/40 text-text-muted hover:text-text-main hover:border-border-dark'
              }`}
            >
              {s === 'env' ? <FileText className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
              {s === 'env' ? 'Read from .env file' : 'Read from Database'}
              {source === s && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            </button>
          ))}
        </div>
        {source === 'env' && dotenvKeys.length > 0 && (
          <div className="text-[10px] text-text-muted/70">
            Keys in .env: <span className="font-mono text-text-muted">{dotenvKeys.join(', ')}</span>
          </div>
        )}
        {source === 'db' && (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
            <CheckCircle2 className="w-3 h-3" />
            Database settings are ACTIVE — all keys below are being used.
          </div>
        )}
      </div>

      {/* Provider cards */}
      {PROVIDERS.map(provider => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          values={values}
          onChange={handleChange}
        />
      ))}

      {/* Advanced */}
      <div className="border border-border-dark/50 rounded-xl overflow-hidden bg-card/10">
        <button
          onClick={() => setAdvOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 border-b border-border-dark/30 bg-[#0F172A]/50 hover:bg-[#0F172A]/80 transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4 text-text-muted/70" />
          <span className="text-sm font-bold text-text-main flex-1 text-left">Advanced</span>
          {advOpen ? <ChevronUp className="w-4 h-4 text-text-muted/50" /> : <ChevronDown className="w-4 h-4 text-text-muted/50" />}
        </button>
        {advOpen && (
          <div className="p-4 space-y-3">
            {ADVANCED_FIELDS.map(field => (
              <div key={field.key} className="space-y-1">
                <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  {field.label}
                </label>
                {field.type === 'password' ? (
                  <SecretInput
                    value={values[field.key] ?? ''}
                    onChange={v => handleChange(field.key, v)}
                    placeholder={field.placeholder}
                  />
                ) : (
                  <input
                    type={field.type}
                    value={values[field.key] ?? ''}
                    onChange={e => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className={inputCls}
                  />
                )}
                {field.hint && <p className="text-[10px] text-text-muted/60">{field.hint}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save + Reload */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all active:scale-95 shadow-neon-blue"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : 'Save to Database'}
        </button>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 border border-border-dark/60 hover:border-border-dark text-text-muted hover:text-text-main text-xs font-semibold rounded-xl transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reload
        </button>

        {/* Toast */}
        {toast && (
          <div className={`flex items-center gap-1.5 text-xs font-semibold animate-fade-in ${toast.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
            {toast.ok
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <AlertCircle  className="w-3.5 h-3.5" />}
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
};

export default EnvSettings;
