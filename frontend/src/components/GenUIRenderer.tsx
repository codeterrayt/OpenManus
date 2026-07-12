// src/components/GenUIRenderer.tsx
// Custom Generative UI renderer for interactive widgets produced by the agent.
// Parses JSON schemas describing forms, tables, cards, stats, progress bars,
// and renders them as interactive React components with computation support.

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown,
  ChevronUp,
  Table as TableIcon,
  LayoutList,
  FormInput,
  Calculator,
  BarChart3,
  RotateCcw,
  Activity,
  Layers
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormField {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: string;
  min?: number;
  max?: number;
  step?: number;
}

interface ComputeRule {
  resultField: string;
  label?: string;
  operands: string[];        // field names containing numeric values
  operationField?: string;   // field name containing the operation selector
  formula?: string;          // e.g. "{a} + {b}", "{a} * {b} / 100"
}

interface FormSchema {
  type: 'form';
  title?: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
  compute?: ComputeRule[];
}

interface TableColumn {
  key: string;
  label: string;
}

interface TableSchema {
  type: 'table';
  title?: string;
  columns: TableColumn[];
  rows: Record<string, string | number>[];
}

interface CardSchema {
  type: 'card';
  title?: string;
  description?: string;
  items?: Array<{ label: string; value: string }>;
}

interface ListSchema {
  type: 'list';
  title?: string;
  items: string[];
  ordered?: boolean;
}

interface StatItem {
  label: string;
  value: string | number;
  change?: string;
  icon?: string;
}

interface StatsSchema {
  type: 'stats';
  title?: string;
  items: StatItem[];
}

interface ProgressItem {
  label: string;
  value: number;
  max?: number;
  color?: string;
}

interface ProgressSchema {
  type: 'progress';
  title?: string;
  items: ProgressItem[];
}

type UISchema = FormSchema | TableSchema | CardSchema | ListSchema | StatsSchema | ProgressSchema;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strips problematic fields (functions, callbacks) from raw JSON text
 * so JSON.parse doesn't choke on unescaped newlines / code in strings.
 */
function sanitizeJsonString(raw: string): string {
  // Remove keys whose values look like JS functions (multiline strings with { })
  // Pattern: "onSomething": "function..." or "onSomething": "(event) => ..."
  let cleaned = raw.replace(
    /,?\s*"on[A-Za-z]*"\s*:\s*"[\s\S]*?(?:function|=>)[\s\S]*?"\s*(?=,|\})/gi,
    ''
  );
  // Also strip standalone function(...){...} values not wrapped in proper quotes
  cleaned = cleaned.replace(
    /,?\s*"on[A-Za-z]*"\s*:\s*"[^"]*\\n[^"]*"/g,
    ''
  );
  // Fix trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');
  return cleaned;
}

/**
 * Attempts to extract a JSON UI schema from the raw c1_ui payload.
 */
function extractSchema(payload: string): UISchema | null {
  let jsonStr = payload;

  // Strip <content>...</content> wrapper if present
  const contentMatch = payload.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
  if (contentMatch) {
    jsonStr = contentMatch[1].trim();
  }

  // Attempt 1: direct parse
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && parsed.type) {
      return normalizeSchema(parsed);
    }
  } catch { /* continue to sanitized parse */ }

  // Attempt 2: sanitize then parse
  try {
    const sanitized = sanitizeJsonString(jsonStr);
    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === 'object' && parsed.type) {
      return normalizeSchema(parsed);
    }
  } catch { /* continue to brace extraction */ }

  // Attempt 3: extract first top-level JSON object from freeform text
  const braceIdx = jsonStr.indexOf('{');
  if (braceIdx >= 0) {
    let depth = 0, end = -1;
    for (let i = braceIdx; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') depth++;
      else if (jsonStr[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > braceIdx) {
      try {
        const extracted = sanitizeJsonString(jsonStr.slice(braceIdx, end + 1));
        const parsed = JSON.parse(extracted);
        if (parsed && typeof parsed === 'object' && parsed.type) {
          return normalizeSchema(parsed);
        }
      } catch { /* give up */ }
    }
  }

  return null;
}

/** Auto-detect computation patterns in forms (e.g. calculator with operation selector) */
function normalizeSchema(schema: any): UISchema {
  if (schema.type === 'form' && !schema.compute && schema.fields) {
    const numberFields = schema.fields.filter((f: any) => f.type === 'number');
    const selectField = schema.fields.find((f: any) =>
      f.type === 'select' && f.options?.some((o: string) =>
        /add|subtract|multiply|divide|sum|diff|plus|minus/i.test(o)
      )
    );
    if (numberFields.length >= 2 && selectField) {
      schema.compute = [{
        resultField: '_result',
        label: 'Result',
        operands: numberFields.map((f: any) => f.name),
        operationField: selectField.name
      }];
    }
  }
  // Strip any function-valued keys
  for (const key of Object.keys(schema)) {
    if (typeof schema[key] === 'string' && /^\s*(function|(\(.*\))\s*=>)/.test(schema[key])) {
      delete schema[key];
    }
  }
  return schema as UISchema;
}

/** Execute a computation rule against current form values */
function computeResult(rule: ComputeRule, values: Record<string, string>): string {
  const nums = rule.operands.map(name => parseFloat(values[name] || '0'));

  if (rule.formula) {
    // Replace {fieldName} with value and eval safely
    let expr = rule.formula;
    for (const name of rule.operands) {
      expr = expr.replace(new RegExp(`\\{${name}\\}`, 'g'), String(parseFloat(values[name] || '0')));
    }
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function(`return (${expr})`)();
      return formatNumber(result);
    } catch { return 'Error'; }
  }

  if (rule.operationField) {
    const op = (values[rule.operationField] || '').toLowerCase();
    const [a, b] = nums;
    if (isNaN(a) || isNaN(b)) return '—';
    if (/add|plus|sum|\+/.test(op))           return formatNumber(a + b);
    if (/subtract|minus|diff|-/.test(op))     return formatNumber(a - b);
    if (/multiply|times|product|\*/.test(op)) return formatNumber(a * b);
    if (/divide|÷|\//.test(op))               return b !== 0 ? formatNumber(a / b) : 'Error: Division by zero';
    if (/mod|modulo|%/.test(op))              return b !== 0 ? formatNumber(a % b) : 'Error: Division by zero';
    if (/power|exponent|\^/.test(op))         return formatNumber(Math.pow(a, b));
    return formatNumber(a + b); // default
  }

  return nums.length > 0 ? formatNumber(nums.reduce((a, b) => a + b, 0)) : '—';
}

function formatNumber(n: number): string {
  if (isNaN(n) || !isFinite(n)) return 'Error';
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '');
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const inputClasses = `w-full bg-[#0F172A]/60 border border-border-dark/50 rounded-lg px-3 py-2 text-sm text-text-main
  placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40
  transition-all hover:border-border-dark/80`;

const selectClasses = `${inputClasses} appearance-none cursor-pointer`;

// ─── Sub-components ──────────────────────────────────────────────────────────

const FormRenderer: React.FC<{ schema: FormSchema }> = ({ schema }) => {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of schema.fields) {
      if (f.defaultValue) defaults[f.name] = f.defaultValue;
    }
    return defaults;
  });
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasCompute = !!(schema.compute && schema.compute.length > 0);

  // Live-compute results as the user types
  const computedResults = useMemo(() => {
    if (!hasCompute) return null;
    return schema.compute!.map(rule => ({
      label: rule.label || 'Result',
      value: computeResult(rule, values)
    }));
  }, [hasCompute, schema.compute, values]);

  const handleChange = useCallback((name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }));
    setErrors(prev => { const next = { ...prev }; delete next[name]; return next; });
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    for (const field of schema.fields) {
      if (field.required && !values[field.name]?.trim()) {
        newErrors[field.name] = `${field.label} is required`;
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setSubmitted(true);
  }, [schema.fields, values]);

  const handleReset = useCallback(() => {
    setSubmitted(false);
    setValues(() => {
      const defaults: Record<string, string> = {};
      for (const f of schema.fields) {
        if (f.defaultValue) defaults[f.name] = f.defaultValue;
      }
      return defaults;
    });
    setErrors({});
  }, [schema.fields]);

  if (submitted) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
        {/* Computed results (big display) */}
        {computedResults && computedResults.length > 0 && (
          <div className="text-center py-4">
            {computedResults.map((r, i) => (
              <div key={i} className="mb-3">
                <div className="text-xs uppercase tracking-wider text-text-muted mb-1">{r.label}</div>
                <div className="text-3xl font-bold text-primary font-mono">{r.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Submitted values summary */}
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-xs font-medium">
            {hasCompute ? 'Calculation complete' : 'Submitted successfully'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border border-border-dark/30 rounded-lg p-3 bg-[#0F172A]/40">
          {schema.fields.map(f => (
            <React.Fragment key={f.name}>
              <span className="text-text-muted truncate">{f.label}</span>
              <span className="text-text-main font-medium truncate">{values[f.name] || '—'}</span>
            </React.Fragment>
          ))}
        </div>

        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors mx-auto"
        >
          <RotateCcw className="w-3 h-3" />
          {hasCompute ? 'Calculate again' : 'Submit another'}
        </button>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {schema.title && (
        <div className="flex items-center gap-2 mb-1">
          {hasCompute
            ? <Calculator className="w-4 h-4 text-primary/70" />
            : <FormInput className="w-4 h-4 text-primary/70" />}
          <h3 className="text-sm font-semibold text-text-main tracking-wide">{schema.title}</h3>
        </div>
      )}
      {schema.description && (
        <p className="text-xs text-text-muted -mt-2 mb-3">{schema.description}</p>
      )}

      {schema.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted flex items-center gap-1">
            {field.label}
            {field.required && <span className="text-rose-400 text-[10px]">*</span>}
          </label>

          {field.type === 'select' && field.options ? (
            <div className="relative">
              <select
                value={values[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className={selectClasses}
              >
                <option value="">Select...</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            </div>
          ) : field.type === 'textarea' ? (
            <textarea
              value={values[field.name] || ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              placeholder={field.placeholder || (field.label ? `Enter ${field.label.toLowerCase()}...` : '')}
              rows={3}
              className={`${inputClasses} resize-none`}
            />
          ) : field.type === 'checkbox' ? (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={values[field.name] === 'true'}
                onChange={(e) => handleChange(field.name, e.target.checked ? 'true' : 'false')}
                className="w-4 h-4 rounded border-border-dark/50 bg-[#0F172A]/60 text-primary
                  focus:ring-1 focus:ring-primary/50 cursor-pointer"
              />
              <span className="text-sm text-text-main">{field.placeholder || ''}</span>
            </label>
          ) : field.type === 'range' ? (
            <div className="flex items-center gap-3">
              <input
                type="range"
                value={values[field.name] || String(field.min ?? 0)}
                min={field.min ?? 0}
                max={field.max ?? 100}
                step={field.step ?? 1}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-mono text-primary min-w-[3ch] text-right">
                {(values[field.name] || field.min) ?? 0}
              </span>
            </div>
          ) : (
            <input
              type={field.type || 'text'}
              value={values[field.name] || ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              placeholder={field.placeholder || (field.label ? `Enter ${field.label.toLowerCase()}...` : '')}
              min={field.min}
              max={field.max}
              step={field.step}
              className={inputClasses}
            />
          )}

          <AnimatePresence>
            {errors[field.name] && (
              <motion.div
                key={`err-${field.name}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-1 text-[11px] text-rose-400"
              >
                <AlertCircle className="w-3 h-3" />
                {errors[field.name]}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      {/* Live preview of computed result */}
      {hasCompute && computedResults && (
        <div className="border border-primary/20 rounded-lg p-3 bg-primary/5">
          {computedResults.map((r, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{r.label}:</span>
              <span className="text-lg font-bold font-mono text-primary">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      <button
        type="submit"
        className="w-full flex items-center justify-center gap-2 bg-primary/90 hover:bg-primary text-white
          text-sm font-medium py-2.5 rounded-lg transition-all duration-200
          shadow-neon-blue hover:shadow-lg active:scale-[0.98]"
      >
        {hasCompute ? <Calculator className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
        {schema.submitLabel || (hasCompute ? 'Calculate' : 'Submit')}
      </button>
    </form>
  );
};

const TableRenderer: React.FC<{ schema: TableSchema }> = ({ schema }) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sortedRows = useMemo(() => {
    if (!sortKey) return schema.rows;
    return [...schema.rows].sort((a, b) => {
      const va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortAsc ? cmp : -cmp;
    });
  }, [schema.rows, sortKey, sortAsc]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  return (
    <div className="space-y-2">
      {schema.title && (
        <div className="flex items-center gap-2 mb-2">
          <TableIcon className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-semibold text-text-main tracking-wide">{schema.title}</h3>
          <span className="text-[10px] text-text-muted ml-auto">{schema.rows.length} rows</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border-dark/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0F172A]/60 border-b border-border-dark/40">
              {schema.columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-primary/80 select-none transition-colors"
                >
                  {col.label}
                  {sortKey === col.key && <span className="ml-1">{sortAsc ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => (
              <tr key={idx} className="border-b border-border-dark/20 last:border-0 hover:bg-[#1E293B]/40 transition-colors">
                {schema.columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-text-main">{String(row[col.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CardRenderer: React.FC<{ schema: CardSchema }> = ({ schema }) => (
  <div className="space-y-3">
    {schema.title && <h3 className="text-sm font-semibold text-text-main tracking-wide">{schema.title}</h3>}
    {schema.description && <p className="text-xs text-text-muted">{schema.description}</p>}
    {schema.items && (
      <div className="grid gap-2">
        {schema.items.map((item, idx) => (
          <div key={idx} className="flex justify-between items-center py-1.5 border-b border-border-dark/20 last:border-0">
            <span className="text-xs text-text-muted">{item.label}</span>
            <span className="text-sm font-medium text-text-main">{item.value}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const ListRenderer: React.FC<{ schema: ListSchema }> = ({ schema }) => {
  const Tag = schema.ordered ? 'ol' : 'ul';
  return (
    <div className="space-y-2">
      {schema.title && (
        <div className="flex items-center gap-2 mb-2">
          <LayoutList className="w-4 h-4 text-primary/70" />
          <h3 className="text-sm font-semibold text-text-main tracking-wide">{schema.title}</h3>
        </div>
      )}
      <Tag className={`space-y-1.5 ${schema.ordered ? 'list-decimal' : 'list-disc'} pl-5`}>
        {schema.items.map((item, idx) => (
          <li key={idx} className="text-sm text-text-main">{item}</li>
        ))}
      </Tag>
    </div>
  );
};

const StatsRenderer: React.FC<{ schema: StatsSchema }> = ({ schema }) => (
  <div className="space-y-3">
    {schema.title && (
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-primary/70" />
        <h3 className="text-sm font-semibold text-text-main tracking-wide">{schema.title}</h3>
      </div>
    )}
    <div className={`grid gap-3 ${schema.items.length <= 2 ? 'grid-cols-2' : schema.items.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {schema.items.map((item, idx) => (
        <div key={idx} className="bg-[#0F172A]/60 border border-border-dark/40 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{item.label}</div>
          <div className="text-xl font-bold text-text-main">{item.value}</div>
          {item.change && (
            <div className={`text-[10px] mt-1 font-medium ${item.change.startsWith('+') || item.change.startsWith('↑') ? 'text-emerald-400' : item.change.startsWith('-') || item.change.startsWith('↓') ? 'text-rose-400' : 'text-text-muted'}`}>
              {item.change}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

const ProgressRenderer: React.FC<{ schema: ProgressSchema }> = ({ schema }) => (
  <div className="space-y-3">
    {schema.title && (
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary/70" />
        <h3 className="text-sm font-semibold text-text-main tracking-wide">{schema.title}</h3>
      </div>
    )}
    <div className="space-y-3">
      {schema.items.map((item, idx) => {
        const max = item.max || 100;
        const pct = Math.min(100, Math.max(0, (item.value / max) * 100));
        return (
          <div key={idx} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-muted">{item.label}</span>
              <span className="text-text-main font-medium">{item.value}{max === 100 ? '%' : ` / ${max}`}</span>
            </div>
            <div className="h-2 bg-[#0F172A]/60 rounded-full overflow-hidden border border-border-dark/30">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ backgroundColor: item.color || (pct > 80 ? '#34d399' : pct > 50 ? '#3b82f6' : pct > 25 ? '#f59e0b' : '#ef4444') }}
              />
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// ─── Schema meta helpers ─────────────────────────────────────────────────────

function getSchemaLabel(schema: UISchema): string {
  if ('title' in schema && schema.title) return schema.title;
  const map: Record<string, string> = {
    form: 'Interactive Form',
    table: 'Data Table',
    card: 'Info Card',
    list: 'List',
    stats: 'Statistics',
    progress: 'Progress',
  };
  return map[schema.type] || 'Component';
}

function getSchemaIcon(type: string) {
  const cls = 'w-3.5 h-3.5 flex-shrink-0';
  switch (type) {
    case 'form': return <FormInput className={cls} />;
    case 'table': return <TableIcon className={cls} />;
    case 'card': return <Layers className={cls} />;
    case 'list': return <LayoutList className={cls} />;
    case 'stats': return <BarChart3 className={cls} />;
    case 'progress': return <Activity className={cls} />;
    default: return <Layers className={cls} />;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface GenUIRendererProps {
  payload: string;
}

export const GenUIRenderer: React.FC<GenUIRendererProps> = ({ payload }) => {
  const [collapsed, setCollapsed] = useState(false);
  const schema = extractSchema(payload);

  if (!schema) {
    return (
      <div className="my-2 border border-amber-500/30 rounded-xl overflow-hidden bg-card/10 select-text text-left shadow">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
          <span className="text-[10px] text-amber-400/80 font-mono">⚠ Unable to parse component</span>
        </div>
        <div className="max-h-40 overflow-y-auto">
          <pre className="text-xs text-text-main/70 whitespace-pre-wrap font-mono p-3">
            {payload}
          </pre>
        </div>
      </div>
    );
  }

  const label = getSchemaLabel(schema);
  const icon = getSchemaIcon(schema.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="my-2 border border-border-dark/50 rounded-xl overflow-hidden bg-card/10 select-text text-left shadow-md backdrop-blur-sm"
    >
      {/* ── Header bar ── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-border-dark/30 bg-[#0F172A]/40 hover:bg-[#0F172A]/60 transition-colors cursor-pointer group"
      >
        <span className="text-primary/70 group-hover:text-primary transition-colors">{icon}</span>
        <span className="text-xs font-semibold text-text-muted group-hover:text-text-main transition-colors flex-1 text-left truncate">
          {label}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/60 font-mono uppercase tracking-wider">
          {schema.type}
        </span>
        {collapsed
          ? <ChevronDown className="w-3.5 h-3.5 text-text-muted/60 flex-shrink-0" />
          : <ChevronUp   className="w-3.5 h-3.5 text-text-muted/60 flex-shrink-0" />}
      </button>

      {/* ── Body (collapsible + scroll-capped) ── */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="max-h-[480px] overflow-y-auto overflow-x-hidden p-4">
              {schema.type === 'form'     && <FormRenderer     schema={schema} />}
              {schema.type === 'table'    && <TableRenderer    schema={schema} />}
              {schema.type === 'card'     && <CardRenderer     schema={schema} />}
              {schema.type === 'list'     && <ListRenderer     schema={schema} />}
              {schema.type === 'stats'    && <StatsRenderer    schema={schema} />}
              {schema.type === 'progress' && <ProgressRenderer schema={schema} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default GenUIRenderer;
