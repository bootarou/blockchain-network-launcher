import React, { useState, useCallback } from 'react';
import { useTranslation } from '../i18n';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  Loader2,
  Wallet,
  Key,
  KeyRound,
  MapPin,
  RefreshCw,
  Lock,
  Unlock,
  ChevronDown,
  ChevronRight,
  Coins,
  User,
  Server,
  Layers,
} from 'lucide-react';
import { api } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountInfo {
  privateKey: string;
  publicKey: string;
  address: string;
}

interface NodeInfo {
  name?: string;
  friendlyName?: string;
  roles?: string;
  main?: AccountInfo;
  transport?: AccountInfo;
  remote?: AccountInfo;
  vrf?: AccountInfo;
}

interface MosaicInfo {
  id?: string;
  name?: string;
  accounts?: AccountInfo[];
}

interface AddressesData {
  nemesisSigner?: AccountInfo;
  nodes?: NodeInfo[];
  mosaics?: MosaicInfo[];
}

interface BalanceMosaic {
  id: string;
  amount: string;
}

interface BalanceInfo {
  mosaics?: BalanceMosaic[];
  publicKey?: string;
  importance?: string;
  error?: string;
}

interface AddressViewerProps {
  password: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(amount: string): string {
  const num = BigInt(amount);
  const whole = num / 1000000n;
  const frac = num % 1000000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AddressViewer({ password }: AddressViewerProps) {
  const { t } = useTranslation();

  // addresses data (raw with ENCRYPTED: keys)
  const [addresses, setAddresses] = useState<AddressesData | null>(null);
  // decrypted addresses (with plain private keys)
  const [decryptedAddresses, setDecryptedAddresses] = useState<AddressesData | null>(null);
  // balances per address
  const [balances, setBalances] = useState<Record<string, BalanceInfo>>({});

  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState('');
  const [showPrivateKeys, setShowPrivateKeys] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    nemesisSigner: true,
    nodes: true,
    mosaics: true,
  });

  // ── Load addresses + balances ──────────────────────────────────────────

  const loadAddresses = useCallback(async () => {
    setLoading(true);
    setDecryptedAddresses(null);
    setShowPrivateKeys(false);
    setDecryptError('');
    try {
      const [addrData, balanceData] = await Promise.all([
        api.getAddresses(),
        api.getAddressBalances().catch(() => ({ balances: {} })),
      ]);
      setAddresses(addrData);
      setBalances(balanceData.balances || {});
    } catch {
      alert(t('addressViewer.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const refreshBalances = useCallback(async () => {
    try {
      const data = await api.getAddressBalances();
      setBalances(data.balances || {});
    } catch {
      // silent
    }
  }, []);

  // ── Decrypt private keys ───────────────────────────────────────────────

  const handleDecrypt = useCallback(async () => {
    if (!password) {
      setDecryptError(t('addressViewer.passwordRequired'));
      return;
    }
    setDecrypting(true);
    setDecryptError('');
    try {
      const data = await api.decryptAddresses(password);
      setDecryptedAddresses(data);
      setShowPrivateKeys(true);
    } catch (err: any) {
      setDecryptError(err.message || t('addressViewer.decryptFailed'));
      setDecryptedAddresses(null);
      setShowPrivateKeys(false);
    } finally {
      setDecrypting(false);
    }
  }, [password, t]);

  const handleHidePrivateKeys = useCallback(() => {
    setShowPrivateKeys(false);
    setDecryptedAddresses(null);
  }, []);

  // ── Copy to clipboard ─────────────────────────────────────────────────

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(''), 2000);
  }, []);

  // ── Toggle section ─────────────────────────────────────────────────────

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────

  const CopyButton = ({ text, id }: { text: string; id: string }) => (
    <button
      onClick={() => copyToClipboard(text, id)}
      className="p-1 hover:bg-zinc-700 rounded transition-colors shrink-0"
      title={t('addressViewer.copy')}
    >
      {copiedKey === id ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
      )}
    </button>
  );

  const renderBalance = (address: string) => {
    const info = balances[address];
    if (!info) return null;
    if ('error' in info && info.error) {
      return (
        <span className="text-xs text-zinc-500 italic">{t('addressViewer.balanceUnavailable')}</span>
      );
    }
    const mosaics = info.mosaics || [];
    if (mosaics.length === 0) {
      return <span className="text-xs text-zinc-500">0</span>;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {mosaics.map((m: BalanceMosaic, i: number) => (
          <span key={i} className="text-xs bg-zinc-800 text-amber-300 px-2 py-0.5 rounded-full font-mono">
            <Coins className="w-3 h-3 inline mr-1 -mt-0.5" />
            {formatAmount(m.amount)}
            <span className="text-zinc-500 ml-1">({m.id.substring(0, 8)}…)</span>
          </span>
        ))}
      </div>
    );
  };

  const renderAccountCard = (
    account: AccountInfo,
    label: string,
    icon: React.ReactNode,
    keyPrefix: string,
    decryptedAccount?: AccountInfo,
  ) => {
    const privateKey = showPrivateKeys && decryptedAccount
      ? decryptedAccount.privateKey
      : null;

    return (
      <div
        key={keyPrefix}
        className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 space-y-2"
      >
        {/* Label */}
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-sm font-semibold text-zinc-200">{label}</span>
        </div>

        {/* Address */}
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-xs text-zinc-400">{t('addressViewer.address')}:</span>
          <code className="text-xs text-blue-300 font-mono break-all flex-1">{account.address}</code>
          <CopyButton text={account.address} id={`${keyPrefix}-addr`} />
        </div>

        {/* Balance */}
        <div className="flex items-center gap-2">
          <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-zinc-400">{t('addressViewer.balance')}:</span>
          {renderBalance(account.address)}
        </div>

        {/* Public Key */}
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs text-zinc-400">{t('addressViewer.publicKey')}:</span>
          <code className="text-xs text-emerald-300 font-mono break-all flex-1">{account.publicKey}</code>
          <CopyButton text={account.publicKey} id={`${keyPrefix}-pub`} />
        </div>

        {/* Private Key */}
        <div className="flex items-center gap-2">
          <KeyRound className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-xs text-zinc-400">{t('addressViewer.privateKey')}:</span>
          {privateKey ? (
            <>
              <code className="text-xs text-red-300 font-mono break-all flex-1">{privateKey}</code>
              <CopyButton text={privateKey} id={`${keyPrefix}-priv`} />
            </>
          ) : (
            <span className="text-xs text-zinc-600 italic flex-1">
              {showPrivateKeys ? '—' : t('addressViewer.privateKeyHidden')}
            </span>
          )}
        </div>
      </div>
    );
  };

  const SectionHeader = ({
    id,
    icon,
    title,
    count,
  }: {
    id: string;
    icon: React.ReactNode;
    title: string;
    count: number;
  }) => (
    <button
      onClick={() => toggleSection(id)}
      className="flex items-center gap-2 w-full text-left py-2 hover:text-zinc-100 transition-colors"
    >
      {expandedSections[id] ? (
        <ChevronDown className="w-4 h-4 text-zinc-500" />
      ) : (
        <ChevronRight className="w-4 h-4 text-zinc-500" />
      )}
      {icon}
      <span className="font-semibold text-zinc-200">{title}</span>
      <span className="text-xs text-zinc-500 ml-1">({count})</span>
    </button>
  );

  // ── Main render ────────────────────────────────────────────────────────

  if (!addresses) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-100">
            <Wallet className="w-5 h-5 text-indigo-400" />
            {t('addressViewer.title')}
          </h2>
        </div>
        <p className="text-sm text-zinc-400 mb-4">{t('addressViewer.description')}</p>
        <button
          onClick={loadAddresses}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          {t('addressViewer.loadAddresses')}
        </button>
      </div>
    );
  }

  // Get decrypted counterparts
  const dNodes = decryptedAddresses?.nodes;
  const dNemesis = decryptedAddresses?.nemesisSigner;
  const dMosaics = decryptedAddresses?.mosaics;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-100">
          <Wallet className="w-5 h-5 text-indigo-400" />
          {t('addressViewer.title')}
        </h2>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh balances */}
          <button
            onClick={refreshBalances}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg text-sm transition-colors border border-zinc-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('addressViewer.refreshBalances')}
          </button>

          {/* Decrypt / Hide toggle */}
          {showPrivateKeys ? (
            <button
              onClick={handleHidePrivateKeys}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/50 hover:bg-red-900 text-red-300 rounded-lg text-sm transition-colors border border-red-700/50"
            >
              <EyeOff className="w-3.5 h-3.5" />
              {t('addressViewer.hidePrivateKeys')}
            </button>
          ) : (
            <button
              onClick={handleDecrypt}
              disabled={decrypting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-900/50 hover:bg-amber-900 text-amber-300 rounded-lg text-sm transition-colors border border-amber-700/50 disabled:opacity-50"
            >
              {decrypting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {t('addressViewer.showPrivateKeys')}
            </button>
          )}

          {/* Close */}
          <button
            onClick={() => { setAddresses(null); setDecryptedAddresses(null); setShowPrivateKeys(false); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
          >
            {t('dashboard.close')}
          </button>
        </div>
      </div>

      {/* Decrypt status */}
      {showPrivateKeys && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2">
          <Unlock className="w-3.5 h-3.5" />
          {t('addressViewer.privateKeysVisible')}
        </div>
      )}

      {!showPrivateKeys && !decryptError && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/30 border border-zinc-700/30 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5" />
          {t('addressViewer.privateKeysLocked')}
        </div>
      )}

      {decryptError && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
          ⚠️ {decryptError}
        </div>
      )}

      {/* ── Nemesis Signer ── */}
      {addresses.nemesisSigner && (
        <div>
          <SectionHeader
            id="nemesisSigner"
            icon={<User className="w-4 h-4 text-purple-400" />}
            title={t('addressViewer.nemesisSigner')}
            count={1}
          />
          {expandedSections.nemesisSigner && (
            <div className="ml-6 space-y-3">
              {renderAccountCard(
                addresses.nemesisSigner,
                'Nemesis Signer',
                <User className="w-4 h-4 text-purple-400" />,
                'nemesis',
                dNemesis,
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Nodes ── */}
      {addresses.nodes && addresses.nodes.length > 0 && (
        <div>
          <SectionHeader
            id="nodes"
            icon={<Server className="w-4 h-4 text-cyan-400" />}
            title={t('addressViewer.nodes')}
            count={addresses.nodes.length}
          />
          {expandedSections.nodes && (
            <div className="ml-6 space-y-4">
              {addresses.nodes.map((node, ni) => {
                const nodeName = node.name || `node${ni}`;
                const dNode = dNodes?.[ni];
                return (
                  <div key={ni} className="space-y-2">
                    <h4 className="text-sm font-medium text-cyan-300 flex items-center gap-2">
                      <Server className="w-3.5 h-3.5" />
                      {nodeName}
                      {node.friendlyName && (
                        <span className="text-xs text-zinc-500">({node.friendlyName})</span>
                      )}
                      {node.roles && (
                        <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                          {node.roles}
                        </span>
                      )}
                    </h4>
                    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                      {(['main', 'transport', 'remote', 'vrf'] as const).map((keyType) => {
                        const acc = node[keyType];
                        if (!acc) return null;
                        const dAcc = dNode?.[keyType];
                        const iconMap = {
                          main: <Key className="w-4 h-4 text-green-400" />,
                          transport: <Layers className="w-4 h-4 text-blue-400" />,
                          remote: <Server className="w-4 h-4 text-orange-400" />,
                          vrf: <KeyRound className="w-4 h-4 text-pink-400" />,
                        };
                        return renderAccountCard(
                          acc,
                          keyType.toUpperCase(),
                          iconMap[keyType],
                          `node${ni}-${keyType}`,
                          dAcc,
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Mosaics ── */}
      {addresses.mosaics && addresses.mosaics.length > 0 && (
        <div>
          <SectionHeader
            id="mosaics"
            icon={<Coins className="w-4 h-4 text-amber-400" />}
            title={t('addressViewer.mosaics')}
            count={addresses.mosaics.reduce(
              (sum, m) => sum + (m.accounts?.length || 0),
              0,
            )}
          />
          {expandedSections.mosaics && (
            <div className="ml-6 space-y-4">
              {addresses.mosaics.map((mosaic, mi) => {
                const mosaicLabel = mosaic.name || mosaic.id || `mosaic${mi}`;
                const dMosaic = dMosaics?.[mi];
                return (
                  <div key={mi} className="space-y-2">
                    <h4 className="text-sm font-medium text-amber-300 flex items-center gap-2">
                      <Coins className="w-3.5 h-3.5" />
                      {mosaicLabel}
                      {mosaic.id && (
                        <span className="text-xs text-zinc-500 font-mono">ID: {mosaic.id}</span>
                      )}
                    </h4>
                    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                      {mosaic.accounts?.map((acc, ai) => {
                        const dAcc = dMosaic?.accounts?.[ai];
                        return renderAccountCard(
                          acc,
                          `${t('addressViewer.account')} ${ai}`,
                          <Wallet className="w-4 h-4 text-amber-400" />,
                          `mosaic${mi}-acc${ai}`,
                          dAcc,
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
