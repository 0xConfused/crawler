// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useEffect } from 'react';
import {
  Play,
  Sliders,
  Globe,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Square,
  Crosshair,
  Cpu,
  Layers,
  Terminal,
  Gauge,
  Shuffle,
  Compass,
  Code,
  Network,
  Eye,
  EyeOff,
  Key,
} from 'lucide-react';
import {
  CrawlConfig,
  CrawlStatus,
  CustomProxyConfig,
  CustomProxyUrlDestination,
  CustomProxyApiKeyDestination,
} from '../types';
import { safeClampInput } from '../utils/urlUtils';

interface CrawlFormProps {
  config: CrawlConfig;
  status: CrawlStatus;
  onUpdateConfig: (newConfig: Partial<CrawlConfig>) => void;
  onStartCrawl: () => void;
  onStopCrawl: () => void;
  paramTab?: 'standard' | 'advanced';
  onParamTabChange?: (tab: 'standard' | 'advanced') => void;
  showAdvanced?: boolean;
  onShowAdvancedChange?: (show: boolean) => void;
  isTermsAccepted?: boolean;
  onRequestTerms?: () => void;
}

export const CrawlForm: React.FC<CrawlFormProps> = ({
  config,
  status,
  onUpdateConfig,
  onStartCrawl,
  onStopCrawl,
  paramTab: controlledParamTab,
  onParamTabChange,
  showAdvanced: controlledShowAdvanced,
  onShowAdvancedChange,
  isTermsAccepted = false,
  onRequestTerms,
}) => {
  const [internalShowAdvanced, setInternalShowAdvanced] = useState(false);
  const [internalParamTab, setInternalParamTab] = useState<'standard' | 'advanced'>('standard');

  const showAdvanced = controlledShowAdvanced !== undefined ? controlledShowAdvanced : internalShowAdvanced;
  const setShowAdvanced = (val: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof val === 'function' ? val(showAdvanced) : val;
    if (onShowAdvancedChange) {
      onShowAdvancedChange(nextVal);
    } else {
      setInternalShowAdvanced(nextVal);
    }
  };

  const paramTab = controlledParamTab !== undefined ? controlledParamTab : internalParamTab;
  const setParamTab = (val: 'standard' | 'advanced') => {
    if (onParamTabChange) {
      onParamTabChange(val);
    } else {
      setInternalParamTab(val);
    }
  };
  const [urlError, setUrlError] = useState<string | null>(null);
  const [delayInputVal, setDelayInputVal] = useState<string>(String(config.requestDelayMs || 50));
  const [isDelayFocused, setIsDelayFocused] = useState<boolean>(false);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const customConfig: CustomProxyConfig = config.customProxyConfig || {
    urlTemplate: config.customProxyUrl || '',
    urlDestination: config.customProxyUrl && config.customProxyUrl.includes('{url}') ? 'placeholder' : 'query',
    urlQueryParam: 'url',
    urlHeaderName: 'X-Target-URL',
    apiKey: config.stealthApiKey || '',
    apiKeyDestination: config.stealthApiKey ? 'header' : 'none',
    apiKeyQueryParam: 'api_key',
    apiKeyHeaderName: 'X-API-Key',
    apiKeyHeaderPrefix: '',
  };

  const updateCustomProxyConfig = (partial: Partial<CustomProxyConfig>) => {
    const updated: CustomProxyConfig = { ...customConfig, ...partial };
    onUpdateConfig({
      customProxyConfig: updated,
      customProxyUrl: updated.urlTemplate,
      stealthApiKey: updated.apiKey,
    });
  };

  useEffect(() => {
    if (!isDelayFocused) {
      setDelayInputVal(String(config.requestDelayMs || 50));
    }
  }, [config.requestDelayMs, isDelayFocused]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTermsAccepted) {
      if (onRequestTerms) {
        onRequestTerms();
      }
      return;
    }
    if (!config.startUrl.trim()) {
      setUrlError('Please enter a target domain or URL to initiate recon.');
      return;
    }
    setUrlError(null);

    const parsedDelay = parseInt(delayInputVal, 10);
    const safeDelay = isNaN(parsedDelay) || parsedDelay < 50 ? 50 : Math.min(9999, parsedDelay);
    setDelayInputVal(String(safeDelay));
    onUpdateConfig({ requestDelayMs: safeDelay });

    onStartCrawl();
  };

  const handleUrlChange = (value: string) => {
    setUrlError(null);
    onUpdateConfig({ startUrl: safeClampInput(value, 200) });
  };

  const isRunning = status === 'running';

  return (
    <div id="crawl-form-card" className="bg-[#141414] border border-[#383838] rounded-none p-5 sm:p-6 shadow-md relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Source Configuration Header */}
        <div>
          <label htmlFor="target-url-input" className="block text-[10px] uppercase tracking-widest text-[#8c8c8c] mb-2 font-mono font-bold flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-[#c30800]" />
              Target Domain
            </span>
            <span className="text-[9px] text-[#737373] tracking-wider">PORT 80/443 ONLY</span>
          </label>
          <div className="flex flex-col sm:flex-row gap-3 min-w-0">
            <div className="relative flex-1 min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8c8c8c]">
                <Globe className="w-4 h-4 text-[#737373]" />
              </div>
              <input
                id="target-url-input"
                type="text"
                maxLength={200}
                placeholder="e.g. example.com or enter URL to recon"
                value={config.startUrl}
                onChange={(e) => handleUrlChange(safeClampInput(e.target.value, 200))}
                disabled={isRunning}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                name="targetDomainUrl"
                className={`w-full pl-10 pr-4 py-2.5 bg-[#0d0d0d] border rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] transition-colors focus:outline-none ${
                  urlError
                    ? 'border-[#c3005a] focus:border-[#c3005a]'
                    : 'border-[#383838] focus:border-[#c30800]'
                } ${isRunning ? 'opacity-70 cursor-not-allowed' : ''}`}
              />
            </div>

            {/* Action Button: Start or Stop */}
            {isRunning ? (
              <button
                type="button"
                id="form-stop-button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStopCrawl();
                }}
                className="px-6 py-2.5 rounded-none bg-[#c3005a]/20 hover:bg-[#c3005a]/30 text-[#f3f3f7] text-xs sm:text-sm font-mono font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer shrink-0 border border-[#c3005a]"
              >
                <Square className="w-3.5 h-3.5 fill-current text-[#c3005a]" />
                ABORT CRAWL
              </button>
            ) : (
              <button
                type="submit"
                id="form-start-button"
                disabled={!isTermsAccepted}
                title={
                  !isTermsAccepted
                    ? 'All three authorization and liability checkboxes must be selected to start crawling'
                    : 'Initiate Recon'
                }
                className={`px-6 py-2.5 rounded-none text-xs sm:text-sm font-mono font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shrink-0 border ${
                  isTermsAccepted
                    ? 'bg-gradient-to-r from-[#c30800] to-[#770500] hover:from-[#f60a00] hover:to-[#770500] text-[#f3f3f7] cursor-pointer border-[#c30800] shadow-md hover:shadow-lg'
                    : 'bg-[#1a1a1a] text-[#737373] border-[#2e2e2e] cursor-not-allowed opacity-50'
                }`}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                INITIATE RECON
              </button>
            )}
          </div>

          {!isTermsAccepted && (
            <p className="mt-2 text-xs text-[#c36a00] flex items-center gap-1.5 font-mono">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Scope authorization and liability terms must be accepted before scanning.{' '}
                {onRequestTerms && (
                  <button
                    type="button"
                    onClick={onRequestTerms}
                    className="underline text-[#f0f0f0] hover:text-[#c30800] cursor-pointer ml-1 font-semibold"
                  >
                    Review &amp; Accept Terms
                  </button>
                )}
              </span>
            </p>
          )}

          {urlError && (
            <p className="mt-2 text-xs text-[#c3005a] flex items-center gap-1.5 font-mono">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {urlError}
            </p>
          )}
        </div>

        {/* Quick Config Parameter Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-[#1a1a1a] p-3 rounded-none border border-[#383838] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#8c8c8c] uppercase tracking-wider font-mono font-semibold">Max Depth</div>
              <div className="text-base sm:text-lg font-mono font-bold text-[#f0f0f0] mt-0.5">
                {config.maxDepth} <span className="text-[10px] text-[#8c8c8c] font-mono">levels</span>
              </div>
            </div>
            <Layers className="w-4 h-4 text-[#c30800]" />
          </div>

          <div className="bg-[#1a1a1a] p-3 rounded-none border border-[#383838] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#8c8c8c] uppercase tracking-wider font-mono font-semibold">Page Limit</div>
              <div className="text-base sm:text-lg font-mono font-bold text-[#f0f0f0] mt-0.5">
                {config.maxPages} <span className="text-[10px] text-[#8c8c8c] font-mono">pages</span>
              </div>
            </div>
            <Globe className="w-4 h-4 text-[#c30800]" />
          </div>

          <div className="bg-[#1a1a1a] p-3 rounded-none border border-[#383838] flex items-center justify-between">
            <div>
              <div className="text-[10px] text-[#8c8c8c] uppercase tracking-wider font-mono font-semibold">Worker Threads</div>
              <div className="text-base sm:text-lg font-mono font-bold text-[#f0f0f0] mt-0.5">
                {config.concurrency} <span className="text-[10px] text-[#8c8c8c] font-mono">threads</span>
              </div>
            </div>
            <Cpu className="w-4 h-4 text-[#c30800]" />
          </div>
        </div>

        {/* Advanced Settings Drawer */}
        <div className="pt-2 border-t border-[#383838]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              id="toggle-advanced-settings-btn"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[10px] font-mono uppercase tracking-widest font-bold text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sliders className="w-3 h-3 text-[#c30800]" />
              <span>{showAdvanced ? 'Collapse Parameters' : 'Adjust Recon Parameters'}</span>
              {showAdvanced ? <ChevronUp className="w-3 h-3 text-[#c30800]" /> : <ChevronDown className="w-3 h-3 text-[#c30800]" />}
            </button>

            {showAdvanced && (
              <div className="flex items-center gap-1 bg-[#0d0d0d] p-1 rounded-none border border-[#383838]">
                <button
                  type="button"
                  id="tab-standard-params-btn"
                  onClick={() => setParamTab('standard')}
                  className={`px-3 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    paramTab === 'standard'
                      ? 'bg-[#262626] text-[#f0f0f0] border border-[#383838] shadow-sm'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                  }`}
                >
                  <Gauge className="w-3 h-3 text-[#c30800]" />
                  Standard
                </button>
                <button
                  type="button"
                  id="tab-advanced-params-btn"
                  onClick={() => setParamTab('advanced')}
                  className={`px-3 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    paramTab === 'advanced'
                      ? 'bg-[#262626] text-[#f0f0f0] border border-[#c30800] shadow-sm'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                  }`}
                >
                  <Terminal className={`w-3 h-3 ${paramTab === 'advanced' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                  Advanced Users
                </button>
              </div>
            )}
          </div>

          {/* Settings Panel */}
          {showAdvanced && (
            <div id="advanced-settings-panel" className="mt-4 p-4 rounded-none bg-[#1a1a1a] border border-[#383838] space-y-4 text-xs">
              {paramTab === 'standard' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Max Depth */}
                  <div className="space-y-1.5" title="Link hops traversal ceiling">
                    <div className="flex justify-between items-center text-[#8c8c8c]">
                      <label htmlFor="max-depth-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold">Max Depth</label>
                      <span className="font-mono text-[#c30800] font-bold">{config.maxDepth} levels</span>
                    </div>
                    <input
                      id="max-depth-input"
                      type="range"
                      min="1"
                      max="10"
                      value={Math.min(config.maxDepth, 10)}
                      onChange={(e) => onUpdateConfig({ maxDepth: parseInt(e.target.value, 10) })}
                      disabled={isRunning}
                      className="w-full cursor-pointer"
                    />
                    <p className="text-[10px] text-[#737373] font-mono">Link hops traversal ceiling</p>
                  </div>

                  {/* Max Pages Limit */}
                  <div className="space-y-1.5" title="Max fetch quota per run">
                    <div className="flex justify-between items-center text-[#8c8c8c]">
                      <label htmlFor="max-pages-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold">Max Pages</label>
                      <span className="font-mono text-[#c30800] font-bold">{config.maxPages} pages</span>
                    </div>
                    <input
                      id="max-pages-input"
                      type="range"
                      min="5"
                      max="200"
                      step="5"
                      value={Math.min(config.maxPages, 200)}
                      onChange={(e) => onUpdateConfig({ maxPages: parseInt(e.target.value, 10) })}
                      disabled={isRunning}
                      className="w-full cursor-pointer"
                    />
                    <p className="text-[10px] text-[#737373] font-mono">Max fetch quota per run</p>
                  </div>

                  {/* Concurrency */}
                  <div className="space-y-1.5" title="Simultaneous worker pool">
                    <div className="flex justify-between items-center text-[#8c8c8c]">
                      <label htmlFor="concurrency-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold">Concurrency</label>
                      <span className="font-mono text-[#c30800] font-bold">{config.concurrency} threads</span>
                    </div>
                    <input
                      id="concurrency-input"
                      type="range"
                      min="1"
                      max="5"
                      value={Math.min(config.concurrency, 5)}
                      onChange={(e) => onUpdateConfig({ concurrency: parseInt(e.target.value, 10) })}
                      disabled={isRunning}
                      className="w-full cursor-pointer"
                    />
                    <p className="text-[10px] text-[#737373] font-mono">Simultaneous worker pool</p>
                  </div>

                  {/* Request Delay */}
                  <div className="space-y-1.5" title="Politeness inter-request throttle (minimum 50 ms enforced)">
                    <div className="flex justify-between items-center text-[#8c8c8c]">
                      <label htmlFor="request-delay-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold">Delay</label>
                      <span className="font-mono text-[#c30800] font-bold">{Math.max(50, config.requestDelayMs)} ms</span>
                    </div>
                    <input
                      id="request-delay-input"
                      type="range"
                      min="50"
                      max="1000"
                      step="50"
                      value={Math.max(50, Math.min(config.requestDelayMs, 1000))}
                      onChange={(e) => onUpdateConfig({ requestDelayMs: Math.max(50, parseInt(e.target.value, 10)) })}
                      disabled={isRunning}
                      className="w-full cursor-pointer"
                    />
                    <p className="text-[10px] text-[#737373] font-mono">Floor: 50 ms</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#383838] pb-2.5">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-[#c30800]" />
                      <span className="font-mono font-bold text-xs uppercase tracking-wider text-[#f0f0f0]">
                        Advanced User Parameter Console
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-none bg-[#141414] border border-[#383838] text-[#8c8c8c] text-[10px] font-mono">
                      <AlertCircle className="w-3 h-3 text-[#c36a00] shrink-0" />
                      <span>Throttle floor of 50 ms enforced to prevent remote rate-limiting.</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Max Depth */}
                    <div className="space-y-1.5" title="Link hops traversal ceiling">
                      <label htmlFor="adv-max-depth-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold block">
                        Max Depth
                      </label>
                      <input
                        id="adv-max-depth-input"
                        type="number"
                        min="1"
                        max="9999"
                        step="1"
                        placeholder="e.g. 15"
                        value={config.maxDepth || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          onUpdateConfig({ maxDepth: isNaN(val) ? 1 : Math.min(9999, Math.max(1, val)) });
                        }}
                        disabled={isRunning}
                        className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                      />
                      <p className="text-[10px] text-[#737373] font-mono">Link traversal depth</p>
                    </div>

                    {/* Max Pages */}
                    <div className="space-y-1.5" title="Max fetch quota per run">
                      <label htmlFor="adv-max-pages-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold block">
                        Max Pages
                      </label>
                      <input
                        id="adv-max-pages-input"
                        type="number"
                        min="1"
                        max="9999"
                        step="1"
                        placeholder="e.g. 500"
                        value={config.maxPages || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          onUpdateConfig({ maxPages: isNaN(val) ? 1 : Math.min(9999, Math.max(1, val)) });
                        }}
                        disabled={isRunning}
                        className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                      />
                      <p className="text-[10px] text-[#737373] font-mono">Max fetch quota</p>
                    </div>

                    {/* Concurrency */}
                    <div className="space-y-1.5" title="Simultaneous worker pool">
                      <label htmlFor="adv-concurrency-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold block">
                        Concurrency
                      </label>
                      <input
                        id="adv-concurrency-input"
                        type="number"
                        min="1"
                        max="8"
                        step="1"
                        placeholder="e.g. 5 (max 8)"
                        value={config.concurrency || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          onUpdateConfig({ concurrency: isNaN(val) ? 1 : Math.min(8, Math.max(1, val)) });
                        }}
                        disabled={isRunning}
                        className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                      />
                      <p className="text-[10px] text-[#737373] font-mono">Thread workers (1-8)</p>
                    </div>

                    {/* Delay */}
                    <div className="space-y-1.5" title="Politeness inter-request throttle (minimum 50 ms enforced)">
                      <div className="flex justify-between items-center">
                        <label htmlFor="adv-delay-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold block">
                          Delay (ms)
                        </label>
                        <span className="text-[9px] font-mono text-[#737373] font-semibold uppercase">Min 50 ms</span>
                      </div>
                      <input
                        id="adv-delay-input"
                        type="number"
                        min="0"
                        max="9999"
                        step="10"
                        placeholder="min 50"
                        value={delayInputVal}
                        onFocus={() => setIsDelayFocused(true)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setDelayInputVal(raw);
                          const val = parseInt(raw, 10);
                          if (!isNaN(val)) {
                            onUpdateConfig({ requestDelayMs: Math.min(9999, val) });
                          }
                        }}
                        onBlur={() => {
                          setIsDelayFocused(false);
                          const val = parseInt(delayInputVal, 10);
                          if (isNaN(val) || val < 50) {
                            setDelayInputVal('50');
                            onUpdateConfig({ requestDelayMs: 50 });
                          } else {
                            const clamped = Math.min(9999, val);
                            setDelayInputVal(String(clamped));
                            onUpdateConfig({ requestDelayMs: clamped });
                          }
                        }}
                        disabled={isRunning}
                        className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                      />
                      <p className="text-[10px] text-[#737373] font-mono">Floor: 50 ms</p>
                    </div>
                  </div>

                  {/* Advanced Path Regex Filters */}
                  <div className="pt-3 border-t border-[#383838]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label htmlFor="path-filter-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold">Include Path Regex (Optional)</label>
                        <input
                          id="path-filter-input"
                          type="text"
                          maxLength={200}
                          placeholder="e.g. ^/(docs|api)/"
                          value={config.pathFilter || ''}
                          onChange={(e) => onUpdateConfig({ pathFilter: safeClampInput(e.target.value, 200) })}
                          disabled={isRunning}
                          className="w-full px-3 py-1.5 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                        />
                        <p className="text-[10px] text-[#737373] font-mono">Include regex pattern</p>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="exclude-filter-input" className="text-[10px] font-mono uppercase tracking-wider text-[#8c8c8c] font-bold">Exclude Path Regex (Optional)</label>
                        <input
                          id="exclude-filter-input"
                          type="text"
                          maxLength={200}
                          placeholder="e.g. \.(jpg|png|zip)$|/tag/"
                          value={config.excludeFilter || ''}
                          onChange={(e) => onUpdateConfig({ excludeFilter: safeClampInput(e.target.value, 200) })}
                          disabled={isRunning}
                          className="w-full px-3 py-1.5 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                        />
                        <p className="text-[10px] text-[#737373] font-mono">Exclude regex pattern</p>
                      </div>
                    </div>
                  </div>



                  {/* Client Engine & CORS Proxy Execution Mode */}
                  <div id="cors-proxy-settings-card" className="pt-3 border-t border-[#383838]">
                    <div className="p-3 bg-[#141414] border border-[#383838] rounded-none space-y-3">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <span className="font-mono text-xs font-bold text-[#f0f0f0] flex items-center gap-1.5">
                            <Network className="w-3.5 h-3.5 text-[#c30800]" />
                            Client Engine &amp; CORS Fetch Mode
                          </span>
                          <p className="text-[11px] text-[#8c8c8c] font-mono">
                            Direct unproxied browser fetch by default, public waterfall with health checks, or configurable custom proxy.
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            id="cors-proxy-mode-select"
                            value={config.corsProxyMode || 'direct'}
                            onChange={(e) => onUpdateConfig({ corsProxyMode: e.target.value as any })}
                            disabled={isRunning}
                            className="px-2.5 py-1.5 bg-[#0d0d0d] border border-[#383838] font-mono text-xs text-[#f0f0f0] hover:border-[#c30800] focus:border-[#c30800] cursor-pointer"
                          >
                            <option value="direct">Direct Fetch</option>
                            <option value="public">Public Proxy</option>
                            <option value="custom">Custom Proxy</option>
                          </select>
                        </div>
                      </div>





                      {/* 3. CUSTOM PROXY CONFIGURATION */}
                      {config.corsProxyMode === 'custom' && (
                        <div className="p-3 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none space-y-3 font-mono">
                          {/* Proxy URL Template Input */}
                          <div className="space-y-1">
                            <label htmlFor="custom-proxy-url-input" className="block text-[10px] font-mono text-[#8c8c8c] uppercase font-bold">
                              Proxy URL / Endpoint Template
                            </label>
                            <input
                              id="custom-proxy-url-input"
                              type="text"
                              maxLength={300}
                              placeholder="https://proxy.example.com/?url={url}"
                              value={customConfig.urlTemplate || ''}
                              onChange={(e) => updateCustomProxyConfig({ urlTemplate: safeClampInput(e.target.value, 300) })}
                              disabled={isRunning}
                              className="w-full px-3 py-1.5 bg-[#141414] border border-[#383838] font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                            />
                            <p className="text-[10px] text-[#737373]">
                              Supported template tokens: <span className="text-[#f0f0f0]">{'{url}'}</span> (encoded target), <span className="text-[#f0f0f0]">{'{raw_url}'}</span> (unencoded target), <span className="text-[#f0f0f0]">{'{apiKey}'}</span> (injected key).
                            </p>
                          </div>

                          {/* Placement Breakdown (2 Columns) */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[#2e2e2e]">
                            {/* Column 1: Target URL Delivery */}
                            <div className="p-2.5 bg-[#141414] border border-[#383838] space-y-2">
                              <span className="text-[10px] uppercase font-bold text-[#f0f0f0] tracking-wider block">
                                Target URL Delivery
                              </span>

                              <div className="space-y-1">
                                <select
                                  id="custom-proxy-url-destination-select"
                                  value={customConfig.urlDestination === 'header' ? 'header' : 'template'}
                                  onChange={(e) => updateCustomProxyConfig({ urlDestination: e.target.value as CustomProxyUrlDestination })}
                                  disabled={isRunning}
                                  className="w-full px-2 py-1 bg-[#0d0d0d] border border-[#383838] text-xs text-[#f0f0f0] focus:border-[#c30800]"
                                >
                                  <option value="template">Endpoint Template (via {'{url}'})</option>
                                  <option value="header">Request Header</option>
                                </select>
                              </div>

                              {customConfig.urlDestination === 'header' && (
                                <div className="space-y-1 pt-1">
                                  <label htmlFor="custom-proxy-url-header-name" className="text-[10px] text-[#8c8c8c] block">
                                    Target Header Name
                                  </label>
                                  <input
                                    id="custom-proxy-url-header-name"
                                    type="text"
                                    maxLength={50}
                                    placeholder="X-Target-URL"
                                    value={customConfig.urlHeaderName || 'X-Target-URL'}
                                    onChange={(e) => updateCustomProxyConfig({ urlHeaderName: safeClampInput(e.target.value, 50) })}
                                    disabled={isRunning}
                                    className="w-full px-2 py-1 bg-[#0d0d0d] border border-[#383838] text-xs text-[#f0f0f0] focus:border-[#c30800]"
                                  />
                                </div>
                              )}
                            </div>

                            {/* Column 2: API Key & Authorization */}
                            <div className="p-2.5 bg-[#141414] border border-[#383838] space-y-2">
                              <span className="text-[10px] uppercase font-bold text-[#f0f0f0] tracking-wider block">
                                API Key &amp; Token
                              </span>

                              {/* API Key Input */}
                              <div className="space-y-1">
                                <div className="relative flex items-center">
                                  <input
                                    id="custom-proxy-api-key-input"
                                    type={showApiKey ? 'text' : 'password'}
                                    maxLength={200}
                                    placeholder="Enter API key or access token"
                                    value={customConfig.apiKey || ''}
                                    onChange={(e) => updateCustomProxyConfig({ apiKey: safeClampInput(e.target.value, 200) })}
                                    disabled={isRunning}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full pl-2 pr-8 py-1 bg-[#0d0d0d] border border-[#383838] text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-1.5 text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors p-0.5"
                                    title={showApiKey ? 'Hide Token' : 'Reveal Token'}
                                  >
                                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>

                              {/* Key Delivery Mode */}
                              <div className="space-y-1">
                                <select
                                  id="custom-proxy-api-key-destination-select"
                                  value={customConfig.apiKeyDestination === 'header' ? 'header' : 'template'}
                                  onChange={(e) => updateCustomProxyConfig({ apiKeyDestination: e.target.value as CustomProxyApiKeyDestination })}
                                  disabled={isRunning}
                                  className="w-full px-2 py-1 bg-[#0d0d0d] border border-[#383838] text-xs text-[#f0f0f0] focus:border-[#c30800]"
                                >
                                  <option value="template">Endpoint Template (via {'{apiKey}'}) / None</option>
                                  <option value="header">Request Header</option>
                                </select>
                              </div>

                              {customConfig.apiKeyDestination === 'header' && (
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                  <div className="space-y-0.5">
                                    <label htmlFor="custom-proxy-header-name" className="text-[9px] text-[#8c8c8c] block">
                                      Header Name
                                    </label>
                                    <input
                                      id="custom-proxy-header-name"
                                      type="text"
                                      maxLength={50}
                                      placeholder="X-API-Key"
                                      value={customConfig.apiKeyHeaderName || 'X-API-Key'}
                                      onChange={(e) => updateCustomProxyConfig({ apiKeyHeaderName: safeClampInput(e.target.value, 50) })}
                                      disabled={isRunning}
                                      className="w-full px-2 py-1 bg-[#0d0d0d] border border-[#383838] text-xs text-[#f0f0f0] focus:border-[#c30800]"
                                    />
                                  </div>
                                  <div className="space-y-0.5">
                                    <label htmlFor="custom-proxy-header-prefix" className="text-[9px] text-[#8c8c8c] block">
                                      Prefix
                                    </label>
                                    <input
                                      id="custom-proxy-header-prefix"
                                      type="text"
                                      maxLength={30}
                                      placeholder="e.g. Bearer "
                                      value={customConfig.apiKeyHeaderPrefix ?? ''}
                                      onChange={(e) => updateCustomProxyConfig({ apiKeyHeaderPrefix: safeClampInput(e.target.value, 30) })}
                                      disabled={isRunning}
                                      className="w-full px-2 py-1 bg-[#0d0d0d] border border-[#383838] text-xs text-[#f0f0f0] focus:border-[#c30800]"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Shared Crawl Filters & Flags */}
              <div className="pt-3 border-t border-[#383838]">
                {/* Categorized Recon & Mapping Configuration Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 font-mono text-[11px]">
                  {/* Category 1: API Surface Discovery & Mapping */}
                  <div className="bg-[#141414] border border-[#383838] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[#f0f0f0] font-bold text-xs uppercase tracking-wider pb-2 border-b border-[#2e2e2e]">
                      <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                      <Code className="w-3.5 h-3.5 text-[#c30800]" />
                      <span>API Discovery &amp; Mapping</span>
                    </div>

                    <div className="space-y-1.5">
                      {/* Capture API calls & endpoints */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.captureApiCalls
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="capture-api-calls-checkbox"
                          type="checkbox"
                          checked={config.captureApiCalls ?? false}
                          onChange={(e) => onUpdateConfig({ captureApiCalls: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Capture API Endpoints</span>
                      </label>

                      {/* Always Query API & Map Possible Queries */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.autoQueryApis
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="auto-query-apis-checkbox"
                          type="checkbox"
                          checked={config.autoQueryApis ?? false}
                          onChange={(e) => onUpdateConfig({ autoQueryApis: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Query Candidate Endpoints</span>
                      </label>
                    </div>
                  </div>

                  {/* Category 2: Network & Identity */}
                  <div className="bg-[#141414] border border-[#383838] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[#f0f0f0] font-bold text-xs uppercase tracking-wider pb-2 border-b border-[#2e2e2e]">
                      <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                      <Shuffle className="w-3.5 h-3.5 text-[#c30800]" />
                      <span>Network &amp; Identity</span>
                    </div>

                    <div className="space-y-1.5">
                      {/* Query Certificate Transparency (crt.sh) */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.queryCrtSubdomains
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="query-crt-subdomains-checkbox"
                          type="checkbox"
                          checked={config.queryCrtSubdomains ?? false}
                          onChange={(e) => onUpdateConfig({ queryCrtSubdomains: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Query Certificate Transparency</span>
                      </label>

                      {/* Allow Cross-Subdomain Traversal */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.allowSubdomains
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="allow-subdomains-checkbox"
                          type="checkbox"
                          checked={config.allowSubdomains ?? false}
                          onChange={(e) => onUpdateConfig({ allowSubdomains: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Cross-Subdomain Traversal</span>
                      </label>
                    </div>
                  </div>

                  {/* Category 3: Recon & Seed Sources */}
                  <div className="bg-[#141414] border border-[#383838] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[#f0f0f0] font-bold text-xs uppercase tracking-wider pb-2 border-b border-[#2e2e2e]">
                      <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                      <Compass className="w-3.5 h-3.5 text-[#c30800]" />
                      <span>Recon &amp; Seed Sources</span>
                    </div>

                    <div className="space-y-1.5">
                      {/* Parse robots.txt & Sitemaps */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.includeRobotsTxt
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="include-robots-txt-checkbox"
                          type="checkbox"
                          checked={config.includeRobotsTxt ?? false}
                          onChange={(e) => onUpdateConfig({ includeRobotsTxt: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Parse robots.txt &amp; Sitemaps</span>
                      </label>

                      {/* Parse AI assistance files */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.includeAiAssistance
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="include-ai-assistance-checkbox"
                          type="checkbox"
                          checked={config.includeAiAssistance ?? false}
                          onChange={(e) => onUpdateConfig({ includeAiAssistance: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">AI Manifests (llms.txt)</span>
                      </label>
                    </div>
                  </div>

                  {/* Category 4: URL Normalization & Hygiene */}
                  <div className="bg-[#141414] border border-[#383838] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[#f0f0f0] font-bold text-xs uppercase tracking-wider pb-2 border-b border-[#2e2e2e]">
                      <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                      <Layers className="w-3.5 h-3.5 text-[#c30800]" />
                      <span>URL Normalization</span>
                    </div>

                    <div className="space-y-1.5">
                      {/* Strip Query Strings */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.stripQueryParams
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="strip-query-params-checkbox"
                          type="checkbox"
                          checked={config.stripQueryParams ?? false}
                          onChange={(e) => onUpdateConfig({ stripQueryParams: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Strip Query Strings (?utm=)</span>
                      </label>

                      {/* Strip Fragment Anchors */}
                      <label className={`flex items-center gap-2.5 px-3 py-2 border transition-colors cursor-pointer select-none ${
                        config.stripHash
                          ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0]'
                          : 'bg-[#0d0d0d] border-[#2e2e2e] text-[#8c8c8c] hover:border-[#383838] hover:text-[#f0f0f0]'
                      }`}>
                        <input
                          id="strip-hash-checkbox"
                          type="checkbox"
                          checked={config.stripHash ?? false}
                          onChange={(e) => onUpdateConfig({ stripHash: e.target.checked })}
                          disabled={isRunning}
                          className="cursor-pointer shrink-0"
                        />
                        <span className="font-bold text-xs text-[#f0f0f0]">Strip Fragment Anchors (#top)</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

