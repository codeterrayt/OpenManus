// src/components/MarkdownRenderer.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Regex to find raw http/https links, localhost URLs, or IP URLs 
// and auto-link them if they are not already in markdown link format.
export const autoLinkUrls = (text: string): string => {
  if (!text) return '';
  const regex = /(?<![\[\(])(https?:\/\/(?:localhost|127\.0\.0\.1|[a-zA-Z0-9.-]+)(?::\d+(?!\d))?(?:[^\s\)]*)|localhost:\d+(?!\d)|127\.0\.0\.1:\d+(?!\d))(?![\]\)])/gi;
  return text.replace(regex, (match) => {
    let url = match;
    if (!/^https?:\/\//i.test(match)) {
      url = 'http://' + match;
    }
    return `[${match}](${url})`;
  });
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const processedContent = autoLinkUrls(content);
  return (
    <div className={`markdown-body text-text-main text-sm font-sans ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !className || !className.includes('language-');

            if (!isInline) {
              return (
                <CodeBlock
                  code={String(children).replace(/\n$/, '')}
                  language={match ? match[1] : 'text'}
                />
              );
            }

            return (
              <code
                className="px-1.5 py-0.5 mx-0.5 rounded bg-bg-secondary text-secondary font-mono text-[13px] border border-border-dark"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Custom heading sizes
          h1: ({ children }) => <h1 className="text-xl font-bold font-heading text-text-main mt-4 mb-2 tracking-tight">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold font-heading text-text-main mt-3.5 mb-1.5 tracking-tight">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold font-heading text-text-main mt-3 mb-1">{children}</h3>,
          
          // Custom lists styling
          ul: ({ children }) => <ul className="list-disc list-inside mb-4 pl-1 space-y-1 text-text-muted">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-4 pl-1 space-y-1 text-text-muted">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          
          // Enhanced blockquote rendering
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/60 bg-bg-secondary/40 px-4 py-2.5 my-3.5 rounded-r-md text-text-muted italic text-[13px] leading-relaxed">
              {children}
            </blockquote>
          ),
          
          // Link rendering
          a: ({ href, children }) => {
            let adjustedHref = href || '';
            if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(adjustedHref)) {
              const host = window.location.hostname || 'localhost';
              adjustedHref = adjustedHref.replace(/(localhost|127\.0\.0\.1)/i, host);
            }
            return (
              <a
                href={adjustedHref}
                target="_self"
                rel="noopener noreferrer"
                className="text-primary hover:text-secondary underline font-medium transition-colors cursor-pointer"
              >
                {children}
              </a>
            );
          },
          
          // Image rendering
          img: ({ src, alt }) => (
            <div className="my-4 rounded-xl overflow-hidden border border-border-dark shadow-neon-blue max-w-full bg-[#0B0F19]/45">
              <img src={src} alt={alt || 'Agent generated asset'} className="max-h-[400px] object-contain mx-auto" />
              {alt && <div className="p-2 bg-card text-center text-[10px] text-text-muted border-t border-border-dark/50 font-sans">{alt}</div>}
            </div>
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
