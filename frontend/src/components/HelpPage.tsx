import React, { useState } from 'react';
import {
  BookOpen,
  Rocket,
  Monitor,
  Settings,
  Globe,
  LayoutDashboard,
  HelpCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Server,
  RefreshCw,
  Trash2,
  Play,
  Square,
  Activity,
  Hammer,
  Share2,
  Package,
  Download,
  Upload,
  Shield,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from '../i18n';

// ── Collapsible Section ──────────────────────────────────────────────────────

function Section({
  id,
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-zinc-900/50 hover:bg-zinc-900 transition-colors text-left"
      >
        <Icon className="w-5 h-5 text-indigo-400 shrink-0" />
        <span className="font-semibold text-zinc-100 flex-1">{title}</span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        )}
      </button>
      {open && <div className="px-5 py-4 space-y-4 text-sm text-zinc-300 leading-relaxed">{children}</div>}
    </section>
  );
}

// ── Mini Table ───────────────────────────────────────────────────────────────

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 border-b border-zinc-700 text-zinc-400 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-zinc-800/50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, color = 'zinc' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
    red: 'bg-red-900/50 text-red-300 border-red-800',
    yellow: 'bg-amber-900/50 text-amber-300 border-amber-800',
    zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    indigo: 'bg-indigo-900/50 text-indigo-300 border-indigo-800',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${colors[color] ?? colors.zinc}`}>
      {children}
    </span>
  );
}

// ── Step indicator ───────────────────────────────────────────────────────────

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <div className="pt-0.5">{children}</div>
    </div>
  );
}

// ── Main Help Page ───────────────────────────────────────────────────────────

export function HelpPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <BookOpen className="w-7 h-7 text-indigo-400" />
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">{t('help.title')}</h2>
          <p className="text-zinc-500 text-sm">{t('help.subtitle')}</p>
        </div>
      </div>

      {/* Quick TOC */}
      <nav className="bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">{t('help.toc')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {[
            { label: t('help.tocQuickStart'), href: '#quickstart', icon: Rocket },
            { label: t('help.tocCreateNetwork'), href: '#create-network', icon: Hammer },
            { label: t('help.tocSharePackage'), href: '#share-network', icon: Share2 },
            { label: t('help.tocScreens'), href: '#screens', icon: Monitor },
            { label: t('help.tocJoinDetail'), href: '#join', icon: Globe },
            { label: t('help.tocButtons'), href: '#buttons', icon: LayoutDashboard },
            { label: t('help.tocResetDiff'), href: '#reset', icon: RefreshCw },
            { label: t('help.tocTroubleshoot'), href: '#trouble', icon: AlertTriangle },
          ].map(({ label, href, icon: I }) => (
            <a
              key={href}
              href={href}
              onClick={(e) => {
                e.preventDefault();
                document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-zinc-200"
            >
              <I className="w-4 h-4" />
              {label}
            </a>
          ))}
        </div>
      </nav>

      {/* ── Sections ── */}

      <Section id="quickstart" title={t('help.quickStartTitle')} icon={Rocket} defaultOpen>
        <p>{t('help.quickStartIntro')}</p>

        <div className="space-y-4 mt-2">
          <Step n={1}>
            <strong>{t('help.quickStartStep1')}</strong>
            <div className="mt-1 bg-zinc-900 rounded-lg px-4 py-2 font-mono text-xs text-zinc-400">
              docker compose up -d --build
            </div>
            <p className="mt-1 text-zinc-500">{t('help.quickStartStep2')}</p>
          </Step>

          <Step n={2}>
            <strong>{t('help.quickStartStep3Title')}</strong>
            <p className="text-zinc-500">{t('help.quickStartStep3Desc')}</p>
            <p className="text-zinc-500">{t('help.quickStartStep3Note')}</p>
          </Step>

          <Step n={3}>
            <strong>{t('help.quickStartStep4')}</strong>
            <p className="text-zinc-500">{t('help.quickStartStep4Desc')}</p>
          </Step>

          <Step n={4}>
            <strong>{t('help.quickStartStep5')}</strong>
            <p className="text-zinc-500">{t('help.quickStartStep5Desc')}</p>
          </Step>

          <Step n={5}>
            <strong>{t('help.quickStartStep6')}</strong>
            <p className="text-zinc-500">{t('help.quickStartStep6Desc')}</p>
          </Step>
        </div>
      </Section>

      <Section id="create-network" title={t('help.createTitle')} icon={Hammer}>
        <p>{t('help.createIntro')}</p>

        <div className="space-y-4 mt-3">
          <Step n={1}>
            <strong>{t('help.createStep1')}</strong>
            <div className="mt-1 bg-zinc-900 rounded-lg px-4 py-2 font-mono text-xs text-zinc-400">
              docker compose up -d --build
            </div>
            <p className="mt-1 text-zinc-500">{t('help.createStep1Desc')}</p>
          </Step>

          <Step n={2}>
            <strong>{t('help.createStep2')}</strong>
            <p className="text-zinc-500 mt-1">{t('help.createStep2Desc')}</p>
            <ul className="list-disc list-inside mt-1 space-y-1 text-zinc-400 text-xs">
              <li>{t('help.createStep2Item1')}</li>
              <li>{t('help.createStep2Item2')}</li>
              <li>{t('help.createStep2Item3')}</li>
              <li>{t('help.createStep2Item4')}</li>
              <li>{t('help.createStep2Item5')}</li>
              <li>{t('help.createStep2Item6')}</li>
              <li>{t('help.createStep2Item7')}</li>
            </ul>
          </Step>

          <Step n={3}>
            <strong>{t('help.createStep3')}</strong>
            <p className="text-zinc-500 mt-1">{t('help.createStep3Desc')}</p>
            <ul className="list-disc list-inside mt-1 space-y-1 text-zinc-400 text-xs">
              <li>{t('help.createStep3Item1')}</li>
              <li>{t('help.createStep3Item2')}</li>
              <li>{t('help.createStep3Item3')}</li>
            </ul>
          </Step>

          <Step n={4}>
            <strong>{t('help.createStep3Item4')}</strong>
            <p className="text-zinc-500 mt-1">{t('help.createStep3Done')}</p>
          </Step>

          <Step n={5}>
            <strong>{t('help.createStep4')}</strong>
            <p className="text-zinc-500 mt-1">{t('help.createStep4Desc')}</p>
          </Step>
        </div>

        <div className="mt-4 bg-amber-950/20 border border-amber-900/30 rounded-lg px-4 py-3">
          <h4 className="font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-4 h-4" />
            {t('help.createNotes')}
          </h4>
          <ul className="list-disc list-inside space-y-1 text-zinc-400 text-xs">
            <li>{t('help.createNote1')}</li>
            <li>{t('help.createNote2')}</li>
            <li>{t('help.createNote3')}</li>
          </ul>
        </div>
      </Section>

      <Section id="share-network" title={t('help.shareTitle')} icon={Share2}>
        <p>{t('help.shareIntro')}</p>

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2 flex items-center gap-2">
          <Package className="w-4 h-4 text-sky-400" />
          {t('help.shareContentsTitle')}
        </h4>
        <Table
          headers={[t('help.shareTableFile'), t('help.shareTableContent')]}
          rows={[
            ['metadata.json', t('help.shareFileMeta')],
            ['custom-preset.yml', t('help.shareFilePreset')],
            ['ui-meta.json', t('help.shareFileUiMeta')],
            ['seed/00000/00001.dat', t('help.shareFileSeedDat')],
            ['seed/00000/00001.stmt', t('help.shareFileSeedStmt')],
            ['seed/00000/hashes.dat', t('help.shareFileSeedHash')],
            ['seed/00000/00001.proof', t('help.shareFileSeedProof')],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-5 mb-2 flex items-center gap-2">
          <Download className="w-4 h-4 text-sky-400" />
          {t('help.shareExportTitle')}
        </h4>
        <div className="space-y-3">
          <Step n={1}>
            <strong>{t('help.shareExportStep1')}</strong>
            <p className="text-zinc-500">{t('help.shareExportStep1Desc')}</p>
          </Step>
          <Step n={2}>
            <strong>{t('help.shareExportStep2')}</strong>
            <p className="text-zinc-500">{t('help.shareExportStep2Desc')}</p>
          </Step>
          <Step n={3}>
            <strong>{t('help.shareExportStep3')}</strong>
            <p className="text-zinc-500">{t('help.shareExportStep3Desc')}</p>
          </Step>
          <Step n={4}>
            <strong>{t('help.shareExportStep4')}</strong>
            <p className="text-zinc-500">{t('help.shareExportStep4Desc')}</p>
          </Step>
          <Step n={5}>
            <strong>{t('help.shareExportStep5')}</strong>
            <p className="text-zinc-500">{t('help.shareExportStep5Desc')}</p>
          </Step>
        </div>

        <h4 className="font-semibold text-zinc-100 mt-5 mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4 text-emerald-400" />
          {t('help.shareImportTitle')}
        </h4>
        <div className="space-y-3">
          <Step n={1}>
            <strong>{t('help.shareImportStep1')}</strong>
            <div className="mt-1 bg-zinc-900 rounded-lg px-4 py-2 font-mono text-xs text-zinc-400">
              docker compose up -d --build
            </div>
          </Step>
          <Step n={2}>
            <strong>{t('help.shareImportStep2')}</strong>
            <p className="text-zinc-500">{t('help.shareImportStep2Desc')}</p>
          </Step>
          <Step n={3}>
            <strong>{t('help.shareImportStep3')}</strong>
            <p className="text-zinc-500">{t('help.shareImportStep3Desc')}</p>
          </Step>
          <Step n={4}>
            <strong>{t('help.shareImportStep4')}</strong>
            <p className="text-zinc-500">{t('help.shareImportStep4Desc')}</p>
          </Step>
          <Step n={5}>
            <strong>{t('help.shareImportStep5')}</strong>
            <p className="text-zinc-500">{t('help.shareImportStep5Desc')}</p>
          </Step>
        </div>

        <div className="mt-4 bg-indigo-950/20 border border-indigo-900/30 rounded-lg px-4 py-3">
          <h4 className="font-semibold text-indigo-300 flex items-center gap-1.5 mb-1">
            <Shield className="w-4 h-4" />
            {t('help.shareSecurityTitle')}
          </h4>
          <ul className="list-disc list-inside space-y-1 text-zinc-400 text-xs">
            <li>{t('help.shareSecurity1')}</li>
            <li>{t('help.shareSecurity2')}</li>
            <li>{t('help.shareSecurity3')}</li>
          </ul>
        </div>

        <h4 className="font-semibold text-zinc-100 mt-5 mb-2">{t('help.shareCompareTitle')}</h4>
        <Table
          headers={[t('help.shareCompareMethod'), t('help.shareCompareContents'), t('help.shareCompareSteps'), t('help.shareCompareRecommend')]}
          rows={[
            [
              <strong className="text-sky-300">{t('help.shareCompareZip')}</strong>,
              t('help.shareCompareZipContent'),
              t('help.shareCompareZipSteps'),
              t('help.shareCompareZipRecommend'),
            ],
            [
              <strong className="text-emerald-300">{t('help.shareCompareJoin')}</strong>,
              t('help.shareCompareJoinContent'),
              t('help.shareCompareJoinSteps'),
              t('help.shareCompareJoinRecommend'),
            ],
            [
              <strong className="text-zinc-300">{t('help.shareCompareManual')}</strong>,
              t('help.shareCompareManualContent'),
              t('help.shareCompareManualSteps'),
              t('help.shareCompareManualRecommend'),
            ],
          ]}
        />
      </Section>

      <Section id="screens" title={t('help.screensTitle')} icon={Monitor}>
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <Globe className="w-4 h-4 text-emerald-400" />
              {t('help.screenJoin')}
            </h4>
            <p>{t('help.screenJoinDesc')}</p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <Settings className="w-4 h-4 text-indigo-400" />
              {t('help.screenConfig')}
            </h4>
            <p>{t('help.screenConfigDesc')}</p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <LayoutDashboard className="w-4 h-4 text-indigo-400" />
              {t('help.screenDashboard')}
            </h4>
            <p>{t('help.screenDashboardDesc')}</p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <Share2 className="w-4 h-4 text-sky-400" />
              {t('help.screenShare')}
            </h4>
            <p>{t('help.screenShareDesc')}</p>
          </div>

          <div>
            <h4 className="font-semibold text-zinc-100 flex items-center gap-2 mb-1">
              <HelpCircle className="w-4 h-4 text-amber-400" />
              {t('help.screenHelp')}
            </h4>
            <p>{t('help.screenHelpDesc')}</p>
          </div>
        </div>
      </Section>

      <Section id="join" title={t('help.joinDetailTitle')} icon={Globe}>
        <h4 className="font-semibold text-zinc-100 mb-2">{t('help.seedFilesTitle')}</h4>
        <Table
          headers={[t('help.seedFileName'), t('help.seedRequired'), t('help.seedContent')]}
          rows={[
            ['00001.dat', <Badge color="red">{t('help.seedRequiredLabel')}</Badge>, t('help.seedDat')],
            ['00001.stmt', <Badge color="yellow">{t('help.seedRecommendedLabel')}</Badge>, t('help.seedStmt')],
            ['hashes.dat', <Badge color="yellow">{t('help.seedRecommendedLabel')}</Badge>, t('help.seedHash')],
            ['proof.index.dat', <Badge color="zinc">{t('help.seedOptionalLabel')}</Badge>, t('help.seedProofIndex')],
            ['00001.proof', <Badge color="zinc">{t('help.seedOptionalLabel')}</Badge>, t('help.seedProof')],
            ['proof.heights.dat', <Badge color="zinc">{t('help.seedOptionalLabel')}</Badge>, t('help.seedProofHeights')],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2">{t('help.catapultVersionTitle')}</h4>
        <p>{t('help.catapultVersionDesc')}</p>
        <Table
          headers={[t('help.catapultColVersion'), t('help.catapultColImage'), t('help.catapultColNote')]}
          rows={[
            ['v2', 'gcc-1.0.3.6', t('help.catapultV2Note')],
            ['v3', 'gcc-1.0.3.9', t('help.catapultV3Note')],
          ]}
        />
      </Section>

      <Section id="buttons" title={t('help.buttonsTitle')} icon={LayoutDashboard}>
        <h4 className="font-semibold text-zinc-100 mb-2">{t('help.buttonsDashTitle')}</h4>
        <Table
          headers={[t('help.buttonsCol'), t('help.buttonsDescCol')]}
          rows={[
            [
              <span className="flex items-center gap-1.5"><Play className="w-3.5 h-3.5 text-emerald-400" /> Start</span>,
              t('help.btnStartDesc'),
            ],
            [
              <span className="flex items-center gap-1.5"><Square className="w-3.5 h-3.5 text-red-400" /> Stop</span>,
              t('help.btnStopDesc'),
            ],
            [
              <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-blue-400" /> Health Check</span>,
              t('help.btnHealthDesc'),
            ],
            [
              <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 text-zinc-400" /> Reset</span>,
              t('help.btnResetDesc'),
            ],
            [
              <span className="flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5 text-red-400" /> {t('help.resetFull')}</span>,
              t('help.btnFullResetDesc'),
            ],
          ]}
        />
      </Section>

      <Section id="reset" title={t('help.resetDiffTitle')} icon={RefreshCw}>
        <Table
          headers={[t('help.resetColOperation'), t('help.resetColConfig'), t('help.resetColBlock'), t('help.resetColCert'), t('help.resetColSeed'), t('help.resetColUse')]}
          rows={[
            [
              <strong>{t('help.resetStopStart')}</strong>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              t('help.resetStopStartUse'),
            ],
            [
              <strong>{t('help.resetResetStart')}</strong>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              <Badge color="red">{t('help.resetDelete')}</Badge>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              <Badge color="green">{t('help.resetKeep')}</Badge>,
              t('help.resetResetStartUse'),
            ],
            [
              <strong>{t('help.resetFull')}</strong>,
              <Badge color="red">{t('help.resetAllDelete')}</Badge>,
              <Badge color="red">{t('help.resetAllDelete')}</Badge>,
              <Badge color="red">{t('help.resetAllDelete')}</Badge>,
              <Badge color="red">{t('help.resetAllDelete')}</Badge>,
              t('help.resetFullUse'),
            ],
          ]}
        />
      </Section>

      <Section id="trouble" title={t('help.troubleTitle')} icon={AlertTriangle}>
        <div className="space-y-5">
          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">{t('help.trouble1Title')}</h4>
            <p className="mb-2">{t('help.trouble1Desc')}</p>
            <p>{t('help.trouble1Fix')}</p>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-red-300 mb-2">{t('help.trouble2Title')}</h4>
            <p className="mb-2">{t('help.trouble2Desc')}</p>
            <p>{t('help.trouble2Fix')}</p>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">{t('help.trouble3Title')}</h4>
            <p className="mb-2">{t('help.trouble3Desc')}</p>
            <p>{t('help.trouble3Fix')}</p>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">{t('help.trouble4Title')}</h4>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>{t('help.trouble4Fix1')}</li>
              <li>{t('help.trouble4Fix2')}</li>
              <li>{t('help.trouble4Fix3')}</li>
              <li>{t('help.trouble4Fix4')}</li>
            </ul>
          </div>

          <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
            <h4 className="font-semibold text-amber-300 mb-2">{t('help.trouble5Title')}</h4>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>{t('help.trouble5Fix1')}</li>
              <li>{t('help.trouble5Fix2')}</li>
              <li>{t('help.trouble5Fix3')}</li>
              <li>{t('help.trouble5Fix4')}</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="tech" title={t('help.techTitle')} icon={Server}>
        <h4 className="font-semibold text-zinc-100 mb-2">{t('help.techStackTitle')}</h4>
        <Table
          headers={[t('help.techColLayer'), t('help.techColTech')]}
          rows={[
            ['Frontend', 'React 19 + Vite + Tailwind CSS v4 + TypeScript'],
            ['Backend', 'Node.js + Express 5 + WebSocket'],
            ['Bootstrap', 'symbol-bootstrap 1.1.10'],
            ['Server V2', 'symbolplatform/symbol-server:gcc-1.0.3.6'],
            ['Server V3', 'symbolplatform/symbol-server:gcc-1.0.3.9'],
            ['REST', 'symbolplatform/symbol-rest:2.4.2'],
            ['Database', 'MongoDB 5.0.15'],
            ['Container', 'Docker-in-Docker (DinD)'],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2">{t('help.techPortTitle')}</h4>
        <Table
          headers={[t('help.techColPort'), t('help.techColUse')]}
          rows={[
            ['4000', t('help.techPort4000')],
            ['7900', t('help.techPort7900')],
            ['3000', t('help.techPort3000')],
            ['27017', t('help.techPort27017')],
            ['7902', t('help.techPort7902')],
          ]}
        />

        <h4 className="font-semibold text-zinc-100 mt-4 mb-2">{t('help.techArchTitle')}</h4>
        <div className="bg-zinc-900 rounded-lg p-4 font-mono text-xs text-zinc-400 whitespace-pre overflow-x-auto">{`Host (Windows/macOS/Linux)
└─ symbol-manager (Docker Container)
   ├─ Frontend (React + Vite)     ← port 4000
   ├─ Backend  (Express + WS)     ← port 4000
   └─ V2 Containers (DinD)
      ├─ api-node-0               ← port 7900
      ├─ broker
      ├─ rest-gateway             ← port 3000
      └─ db (MongoDB)`}</div>
      </Section>
    </div>
  );
}
