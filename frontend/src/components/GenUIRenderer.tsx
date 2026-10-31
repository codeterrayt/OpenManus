// src/components/GenUIRenderer.tsx
// Generative UI renderer powered by OpenUI (https://www.openui.com/).
// Renders native OpenUI Lang streams and bridges legacy JSON schemas in chat.

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Renderer } from '@openuidev/react-lang';
import { openuiLibrary } from '../lib/openui';
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detects if the payload is OpenUI Lang syntax.
 * OpenUI Lang lines match patterns like: `root = Stack(...)` or `varName = Component(...)`
 */
function isOpenUILang(payload: string): boolean {
  const trimmed = payload.trim();
  return /^\w+\s*=\s*\w+\s*\(|root\s*=/m.test(trimmed);
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Attempts to convert a legacy c1_ui JSON schema into OpenUI Lang.
 * This bridges existing agent outputs smoothly to OpenUI.
 */
function legacyJsonToOpenUILang(payload: string): string | null {
  try {
    let jsonStr = payload.trim();

    // Strip <content>...</content> wrapper if present
    const contentMatch = jsonStr.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    if (contentMatch) {
      jsonStr = contentMatch[1].trim();
    }

    const schema = JSON.parse(jsonStr);
    if (!schema || typeof schema !== 'object' || !schema.type) return null;

    return convertSchemaToOpenUILang(schema);
  } catch {
    // Try to extract first top-level JSON object from freeform text
    const braceIdx = payload.indexOf('{');
    if (braceIdx >= 0) {
      let depth = 0, end = -1;
      for (let i = braceIdx; i < payload.length; i++) {
        if (payload[i] === '{') depth++;
        else if (payload[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end > braceIdx) {
        try {
          const extracted = payload.slice(braceIdx, end + 1);
          const schema = JSON.parse(extracted);
          if (schema?.type) return convertSchemaToOpenUILang(schema);
        } catch {
          // unable to parse
        }
      }
    }
    return null;
  }
}

/**
 * Converts a parsed legacy JSON schema into valid OpenUI Lang.
 */
function convertSchemaToOpenUILang(schema: any): string {
  const lines: string[] = [];
  const rootItems: string[] = [];

  const title = schema.title ? String(schema.title).trim() : null;
  if (title) {
    lines.push(`headerTitle = TextContent("${esc(title)}", "large-heavy")`);
    rootItems.push('headerTitle');
  }

  switch (schema.type) {
    case 'table': {
      const cols = Array.isArray(schema.columns) ? schema.columns : [];
      const rows = Array.isArray(schema.rows) ? schema.rows : [];

      const colVars: string[] = [];
      cols.forEach((col: any, idx: number) => {
        const colKey = col.key || `col_${idx}`;
        const colLabel = col.label || colKey;
        const colDataVar = `colData_${idx}`;
        const values = rows.map((r: any) => {
          const v = r[colKey];
          return typeof v === 'number' ? v : `"${esc(String(v ?? ''))}"`;
        });
        lines.push(`${colDataVar} = [${values.join(', ')}]`);
        lines.push(`c${idx} = Col("${esc(colLabel)}", ${colDataVar})`);
        colVars.push(`c${idx}`);
      });

      lines.push(`tbl = Table([${colVars.join(', ')}])`);
      rootItems.push('tbl');
      break;
    }

    case 'stats': {
      const items = Array.isArray(schema.items) ? schema.items : [];
      const kpiVars: string[] = [];

      items.forEach((item: any, idx: number) => {
        const kpiVar = `kpi_${idx}`;
        const lhsVar = `kpiLhs_${idx}`;
        const iconVar = `kpiIcon_${idx}`;
        const rhsVar = `kpiRhs_${idx}`;
        const changeStr = item.change ? `, "${esc(item.change)}"` : '';

        lines.push(`${iconVar} = Icon("circle-dollar-sign", "finance")`);
        lines.push(`${lhsVar} = IconText(${iconVar}, "neutral", "m", "${esc(item.label || 'Metric')}", "Metric", false, "horizontal")`);
        lines.push(`${rhsVar} = BoldText("number", "${esc(String(item.value ?? ''))}"${changeStr}, "metric")`);
        lines.push(`${kpiVar} = SnippetCardItem("kpi_${idx}", ${lhsVar}, ${rhsVar})`);
        kpiVars.push(kpiVar);
      });

      if (kpiVars.length > 0) {
        lines.push(`kpiBlock = SnippetCardBlock([${kpiVars.join(', ')}])`);
        rootItems.push('kpiBlock');
      }
      break;
    }

    case 'list': {
      const items = Array.isArray(schema.items) ? schema.items : [];
      const itemVars: string[] = [];

      items.forEach((it: any, idx: number) => {
        const varName = `listItem_${idx}`;
        lines.push(`${varName} = ListItem("${esc(String(it))}")`);
        itemVars.push(varName);
      });

      const variant = schema.ordered ? '"number"' : '"default"';
      lines.push(`listBlock = ListBlock([${itemVars.join(', ')}], ${variant})`);
      rootItems.push('listBlock');
      break;
    }

    case 'progress': {
      const items = Array.isArray(schema.items) ? schema.items : [];
      const progressText = items.map((it: any) => `• ${esc(it.label)}: ${it.value}%`).join('\\n');
      lines.push(`progContent = TextContent("${progressText}")`);
      rootItems.push('progContent');
      break;
    }

    case 'form': {
      const fields = Array.isArray(schema.fields) ? schema.fields : [];
      const fieldVars: string[] = [];

      fields.forEach((f: any, idx: number) => {
        const fVar = `formField_${idx}`;
        const name = esc(f.name || `field_${idx}`);
        const label = esc(f.label || f.name || 'Field');
        const reqStr = f.required ? ', { required: true }' : '';

        if (f.type === 'textarea') {
          lines.push(`${fVar} = FormControl("${label}", TextArea("${name}", "${label}...", 3${reqStr}))`);
        } else {
          lines.push(`${fVar} = FormControl("${label}", Input("${name}", "${label}...", "${esc(f.type || 'text')}"${reqStr}))`);
        }
        fieldVars.push(fVar);
      });

      const submitText = esc(schema.submitLabel || 'Submit');
      lines.push(`formBtns = Buttons([Button("${submitText}", @ToAssistant("Submit form"), "primary")])`);
      lines.push(`formWidget = Form("form1", formBtns, [${fieldVars.join(', ')}])`);
      rootItems.push('formWidget');
      break;
    }

    case 'card':
    default: {
      const cardTitle = esc(schema.title || 'Information');
      const desc = schema.description ? `\\n${esc(schema.description)}` : '';
      let itemsText = '';
      if (Array.isArray(schema.items)) {
        itemsText = '\\n' + schema.items.map((i: any) => `• ${esc(i.label)}: ${esc(i.value)}`).join('\\n');
      }
      lines.push(`cardContent = TextContent("${cardTitle}${desc}${itemsText}")`);
      rootItems.push('cardContent');
      break;
    }
  }

  // Prepend root = Stack([items])
  const rootLine = `root = Stack([${rootItems.join(', ')}])`;
  return [rootLine, ...lines].join('\n');
}

class OpenUIErrorBoundary extends React.Component<
  { children: React.ReactNode; rawCode: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-3 text-xs bg-red-500/10 border border-red-500/20 rounded-lg text-red-300">
          <p className="font-semibold mb-1">OpenUI Render Error: {this.state.error?.message}</p>
          <pre className="text-[11px] font-mono whitespace-pre-wrap opacity-80 max-h-32 overflow-y-auto">
            {this.props.rawCode}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Normalizes OpenUI Lang code to protect against common LLM formatting mistakes:
 * 1. Strips markdown fences if wrapped in ```openui ... ```
 * 2. Strips Python comments (# ...) that cause AST parse errors in OpenUI Lang
 * 3. Expands Python list comprehensions like `[i for i in range(1, 31)]` into literal array
 * 4. Ensures BarChart, LineChart, and AreaChart have their 2nd argument wrapped in `[Series(...)]`
 *    if the model passed a raw number array or variable holding numbers.
 */
function normalizeOpenUICode(code: string): string {
  let cleaned = code.trim();
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:openui|openui-lang|plaintext|text)?\s*[\r\n]+/, '').replace(/[\r\n]+```$/, '').trim();

  // Expand Python list comprehension: [i for i in range(1, 31)] or [f'Day {i}' for i in range(7)]
  cleaned = cleaned.replace(/\[\s*(?:[f'"]?[^\]\s,]+[f'"]?|\w+)\s+for\s+\w+\s+in\s+range\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)\s*\]/g, (_, start, end) => {
    let s = Number(start);
    let e = end !== undefined ? Number(end) : s;
    if (end === undefined) {
      s = 0;
    }
    const count = Math.min(Math.max(0, e - s), 60);
    return JSON.stringify(Array.from({ length: count }, (__, i) => `Day ${i + s}`));
  });

  const lines = cleaned.split('\n');
  const validLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    validLines.push(trimmed);
  }

  // 1. Scan for all identifiers that are defined as Series(...)
  const seriesVars = new Set<string>();
  for (const line of validLines) {
    const m = line.match(/^(\w+)\s*=\s*Series\(/);
    if (m) seriesVars.add(m[1]);
  }

  const transformedLines: string[] = [];
  const extraSeriesDefs: string[] = [];
  let seriesCounter = 1;

  for (const line of validLines) {
    // Match: chartVar = (BarChart|LineChart|AreaChart)(labels, series, ...)
    const chartMatch = line.match(/^(\w+)\s*=\s*(BarChart|LineChart|AreaChart)\(\s*([^,]+)\s*,\s*([^,)]+)(.*)\)$/);
    if (chartMatch) {
      const [_, varName, chartType, labelsArg, seriesArg, restArgs] = chartMatch;
      const trimmedSeries = seriesArg.trim();

      // Check if it already contains Series(
      const hasInlineSeries = trimmedSeries.includes('Series(');

      // Extract any identifier inside seriesArg, e.g. [populationSeries] -> populationSeries
      const idMatches = trimmedSeries.match(/\b([a-zA-Z_]\w*)\b/g) || [];
      const hasSeriesVar = idMatches.some(id => seriesVars.has(id));

      if (hasInlineSeries || hasSeriesVar) {
        // It's ALREADY a Series!
        // If it's a single seriesVar not in brackets, wrap it in brackets: e.g. BarChart(labels, s1) -> BarChart(labels, [s1])
        if (!trimmedSeries.startsWith('[') && hasSeriesVar) {
          transformedLines.push(`${varName} = ${chartType}(${labelsArg}, [${trimmedSeries}]${restArgs})`);
        } else {
          transformedLines.push(line);
        }
        continue;
      }

      // If it's a raw number array or variable of numbers that is NOT a Series:
      const seriesVarName = `_auto_series_${seriesCounter++}`;
      const seriesTitle = varName.replace(/_/g, ' ').replace(/chart/i, '').trim() || 'Metric';
      extraSeriesDefs.push(`${seriesVarName} = Series("${seriesTitle}", ${trimmedSeries})`);
      transformedLines.push(`${varName} = ${chartType}(${labelsArg}, [${seriesVarName}]${restArgs})`);
      continue;
    }
    transformedLines.push(line);
  }

  return [...transformedLines, ...extraSeriesDefs].join('\n');
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface GenUIRendererProps {
  payload: string;
  isStreaming?: boolean;
}

export const GenUIRenderer: React.FC<GenUIRendererProps> = ({ payload, isStreaming = false }) => {
  const [collapsed, setCollapsed] = useState(false);

  // Resolve the OpenUI Lang code to render
  const openUICode = useMemo(() => {
    if (isOpenUILang(payload)) {
      return normalizeOpenUICode(payload);
    }
    // Attempt legacy JSON → OpenUI Lang conversion
    const converted = legacyJsonToOpenUILang(payload);
    return converted ? normalizeOpenUICode(converted) : null;
  }, [payload]);

  if (!openUICode) {
    // Unparseable payload — show raw fallback
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="my-2 border border-border-dark/50 rounded-xl overflow-hidden bg-[#0F1422] select-text text-left shadow-md backdrop-blur-sm"
    >
      {/* ── Header bar ── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.08] bg-[#121828]/80 hover:bg-[#161F34] transition-colors cursor-pointer group"
      >
        <span className="text-indigo-400 group-hover:text-indigo-300 transition-colors">
          <Sparkles className="w-3.5 h-3.5" />
        </span>
        <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition-colors flex-1 text-left truncate">
          Interactive Component
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-mono uppercase tracking-wider">
          OpenUI
        </span>
        {collapsed
          ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          : <ChevronUp   className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
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
            <div className="max-h-[520px] overflow-y-auto overflow-x-hidden p-4">
              <OpenUIErrorBoundary rawCode={openUICode}>
                <Renderer
                  library={openuiLibrary}
                  response={openUICode}
                  isStreaming={isStreaming}
                  onAction={(event: any) => {
                    console.log('[OpenUI] Action triggered:', event);
                  }}
                />
              </OpenUIErrorBoundary>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default GenUIRenderer;
