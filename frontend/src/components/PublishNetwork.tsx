import React, { useState, useEffect, useCallback } from "react";
import {
  Cloud,
  Settings,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import { api } from "../lib/api";
import { useTranslation } from "../i18n";

interface PublishStatus {
  isPublished: boolean;
  lastPublishedAt?: string;
  port3000?: {
    name: string;
    description: string;
    isPublished: boolean;
    url?: string;
  };
  port7900?: {
    name: string;
    description: string;
    isPublished: boolean;
    url?: string;
  };
}

interface PublishConfig {
  cloudflareToken: string;
  cloudflareZoneId: string;
  cloudflareAccountId: string;
  publish3000: boolean;
  publish7900: boolean;
  subdomain: string;
}

export function PublishNetwork() {
  const { t } = useTranslation();

  const [config, setConfig] = useState<PublishConfig>({
    cloudflareToken: "",
    cloudflareZoneId: "",
    cloudflareAccountId: "",
    publish3000: true,
    publish7900: true,
    subdomain: "symbol-network",
  });

  const [showToken, setShowToken] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const data = await api.getPublishConfig();
      setConfig(data);
      setConfigError(null);
    } catch (err: unknown) {
      setConfigError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await api.getPublishStatus();
      setStatus(data);
    } catch {
      /* ignore */
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [loadConfig, loadStatus]);

  const handleSaveConfig = async () => {
    if (!config.cloudflareToken || !config.cloudflareZoneId || !config.cloudflareAccountId) {
      setConfigError(t("publish.configRequired"));
      return;
    }
    setConfigSaving(true);
    setConfigError(null);
    setConfigSuccess(false);
    try {
      await api.savePublishConfig(config);
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3000);
    } catch (err: unknown) {
      setConfigError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setConfigSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!config.publish3000 && !config.publish7900) {
      setPublishError(t("publish.selectPortsError"));
      return;
    }
    setPublishing(true);
    setPublishError(null);
    setPublishSuccess(false);
    try {
      await api.publishNetwork({ ports: { port3000: config.publish3000, port7900: config.publish7900 }, subdomain: config.subdomain });
      setPublishSuccess(true);
      await loadStatus();
      setTimeout(() => setPublishSuccess(false), 3000);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Failed to publish network");
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm(t("publish.unpublishConfirm"))) return;
    setUnpublishing(true);
    setPublishError(null);
    try {
      await api.unpublishNetwork();
      setPublishSuccess(true);
      await loadStatus();
      setTimeout(() => setPublishSuccess(false), 3000);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Failed to unpublish network");
    } finally {
      setUnpublishing(false);
    }
  };

  const handleConfigChange = (field: keyof PublishConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <Cloud className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-bold">{t("publish.title")}</h2>
        </div>
        <p className="text-zinc-400 text-sm">{t("publish.description")}</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4 text-indigo-400" />
            {t("publish.configTitle")}
          </h3>
          {configLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">{t("publish.tokenLabel")} *</label>
            <div className="flex gap-2">
              <input
                type={showToken ? "text" : "password"}
                value={config.cloudflareToken}
                onChange={(e) => handleConfigChange("cloudflareToken", e.target.value)}
                placeholder={t("publish.tokenPlaceholder")}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button onClick={() => setShowToken(!showToken)} className="px-3 py-2 text-zinc-400 hover:text-zinc-200 transition-colors" title={showToken ? t("publish.hide") : t("publish.show")}>
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-zinc-500 text-xs mt-1">{t("publish.tokenHint")}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">{t("publish.zoneIdLabel")} *</label>
            <input
              type="text"
              value={config.cloudflareZoneId}
              onChange={(e) => handleConfigChange("cloudflareZoneId", e.target.value)}
              placeholder={t("publish.zoneIdPlaceholder")}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-zinc-500 text-xs mt-1">{t("publish.zoneIdHint")}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">{t("publish.accountIdLabel")} *</label>
            <input
              type="text"
              value={config.cloudflareAccountId}
              onChange={(e) => handleConfigChange("cloudflareAccountId", e.target.value)}
              placeholder={t("publish.accountIdPlaceholder")}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-zinc-500 text-xs mt-1">{t("publish.accountIdHint")}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-300 block mb-2">{t("publish.subdomainLabel")}</label>
            <input
              type="text"
              value={config.subdomain}
              onChange={(e) => handleConfigChange("subdomain", e.target.value)}
              placeholder="symbol-network"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-zinc-500 text-xs mt-1">{t("publish.subdomainHint")}</p>
          </div>

          <div className="space-y-3 pt-2">
            <label className="text-sm font-medium text-zinc-300 block">{t("publish.portsLabel")}</label>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="publish3000" checked={config.publish3000} onChange={(e) => handleConfigChange("publish3000", e.target.checked)} className="w-4 h-4 rounded accent-violet-600" />
              <label htmlFor="publish3000" className="text-sm text-zinc-300 cursor-pointer">
                Port <strong>3000</strong> — Symbol Node REST Gateway
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="publish7900" checked={config.publish7900} onChange={(e) => handleConfigChange("publish7900", e.target.checked)} className="w-4 h-4 rounded accent-violet-600" />
              <label htmlFor="publish7900" className="text-sm text-zinc-300 cursor-pointer">
                Port <strong>7900</strong> — Symbol Node Websocket
              </label>
            </div>
          </div>

          {configError && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {configError}
            </div>
          )}
          {configSuccess && (
            <div className="flex items-center gap-2 p-3 bg-emerald-900/30 border border-emerald-800 rounded-lg text-emerald-300 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              {t("publish.configSaved")}
            </div>
          )}

          <button
            onClick={handleSaveConfig}
            disabled={configSaving}
            className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {configSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("publish.saveButton")}
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Cloud className="w-4 h-4 text-violet-400" />
            {t("publish.statusTitle")}
          </h3>
          {statusLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {status ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${status.isPublished ? "bg-emerald-500" : "bg-zinc-600"}`} />
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  {status.isPublished ? t("publish.publishedStatus") : t("publish.notPublishedStatus")}
                </p>
                {status.lastPublishedAt && (
                  <p className="text-xs text-zinc-400">{t("publish.lastPublished")}: {new Date(status.lastPublishedAt).toLocaleString()}</p>
                )}
              </div>
            </div>

            {status.port3000 && (
              <div className="p-3 bg-zinc-800 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-zinc-100">{status.port3000.name}</h4>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${status.port3000.isPublished ? "bg-emerald-900 text-emerald-300" : "bg-zinc-700 text-zinc-400"}`}>
                    {status.port3000.isPublished ? t("publish.active") : t("publish.inactive")}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">{status.port3000.description}</p>
                {status.port3000.url && (
                  <div className="flex items-center gap-2 mt-2">
                    <code className="flex-1 px-2 py-1 bg-zinc-900 rounded text-xs text-zinc-300 break-all">{status.port3000.url}</code>
                    <button onClick={() => copyToClipboard(status.port3000?.url || "")} className="px-2 py-1 text-zinc-400 hover:text-zinc-200 transition-colors" title={t("publish.copy")}>
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {status.port7900 && (
              <div className="p-3 bg-zinc-800 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-zinc-100">{status.port7900.name}</h4>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${status.port7900.isPublished ? "bg-emerald-900 text-emerald-300" : "bg-zinc-700 text-zinc-400"}`}>
                    {status.port7900.isPublished ? t("publish.active") : t("publish.inactive")}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">{status.port7900.description}</p>
                {status.port7900.url && (
                  <div className="flex items-center gap-2 mt-2">
                    <code className="flex-1 px-2 py-1 bg-zinc-900 rounded text-xs text-zinc-300 break-all">{status.port7900.url}</code>
                    <button onClick={() => copyToClipboard(status.port7900?.url || "")} className="px-2 py-1 text-zinc-400 hover:text-zinc-200 transition-colors" title={t("publish.copy")}>
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {publishError && (
              <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {publishError}
              </div>
            )}
            {publishSuccess && (
              <div className="flex items-center gap-2 p-3 bg-emerald-900/30 border border-emerald-800 rounded-lg text-emerald-300 text-sm">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                {t("publish.publishSuccess")}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              {!status.isPublished ? (
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {publishing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("publish.publishButton")}
                </button>
              ) : (
                <button
                  onClick={handleUnpublish}
                  disabled={unpublishing}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {unpublishing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("publish.unpublishButton")}
                </button>
              )}
              <button
                onClick={loadStatus}
                disabled={statusLoading}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 text-sm font-medium rounded-lg transition-colors"
                title={t("publish.refreshStatus")}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <p className="text-zinc-500 text-sm">{t("publish.noStatus")}</p>
        )}
      </div>
    </div>
  );
}
