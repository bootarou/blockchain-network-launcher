// =============================================================================
// Symbol Custom Network Manager — Complete Preset Configuration
// Supports Catapult V2 (1.0.3.6) and V3 (1.0.3.9)
// =============================================================================

// Compute today's Unix timestamp (seconds) at module load time.
// Used as the default epochAdjustment for new networks.
const _todayEpochSec = Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Catapult version presets (V2 / V3 image sets)
// ---------------------------------------------------------------------------

export interface CatapultVersionPreset {
  id: string;
  label: string;
  description: string;
  symbolServerImage: string;
  symbolRestImage: string;
  symbolServerToolsImage: string;
  needsOpenSslPatch: boolean;
  configPatches: {
    file: string;
    section: string;
    props: Record<string, string>;
  }[];
}

export const CATAPULT_VERSIONS: CatapultVersionPreset[] = [
  {
    id: 'v3',
    label: 'V3 — Catapult 1.0.3.9 (Aggregate V3)',
    description: 'Latest version with Aggregate V3 support.',
    symbolServerImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    symbolRestImage: 'symbolplatform/symbol-rest:2.4.4',
    symbolServerToolsImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    needsOpenSslPatch: true,
    configPatches: [
      {
        file: 'config-node.properties',
        section: '[cache_database]',
        props: { maxLogFiles: '100', maxLogFileSize: '25MB' },
      },
      {
        file: 'config-network.properties',
        section: '[fork_heights]',
        props: {
          skipSecretLockUniquenessChecks: '',
          skipSecretLockExpirations: '',
          forceSecretLockExpirations: '',
          uniqueAggregateTransactionHash: '0',
        },
      },
    ],
  },
  {
    id: 'v2',
    label: 'V2 — Catapult 1.0.3.6 (Aggregate V2)',
    description: 'Legacy version for networks still using Aggregate V2.',
    symbolServerImage: 'symbolplatform/symbol-server:gcc-1.0.3.6',
    symbolRestImage: 'symbolplatform/symbol-rest:2.4.2',
    symbolServerToolsImage: 'symbolplatform/symbol-server:gcc-1.0.3.6',
    needsOpenSslPatch: false,
    configPatches: [],
  },
];

// ---------------------------------------------------------------------------
// Optional custom version(s) — for testing locally-built server images.
// Set VITE_CUSTOM_SERVER_IMAGE (e.g. "catapult-server-bnl:local") to add a
// "Custom" entry to the Catapult Version dropdown. List several comma-separated
// to get more than one choice, e.g. "catapult-server-bnl:local,catapult-server-bnl:dev".
// Selecting an entry fills the Server Image field with that image. REST/tools
// images fall back to V3's unless VITE_CUSTOM_REST_IMAGE / VITE_CUSTOM_TOOLS_IMAGE
// are also set (these apply to every custom entry).
// NOTE: the backend must also have CUSTOM_SERVER_IMAGE set to the same list so
// it resolves the custom version instead of defaulting to V3.
// ---------------------------------------------------------------------------
const _customServerImages = ((import.meta.env.VITE_CUSTOM_SERVER_IMAGE as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (_customServerImages.length > 0) {
  const _v3 = CATAPULT_VERSIONS[0];
  _customServerImages.forEach((image, i) => {
    CATAPULT_VERSIONS.push({
      id: i === 0 ? 'custom' : `custom-${i + 1}`,
      label: `Custom — ${image}`,
      description: 'ローカルビルドのサーバーイメージをテスト（VITE_CUSTOM_SERVER_IMAGE / backend CUSTOM_SERVER_IMAGE）。',
      symbolServerImage: image,
      symbolRestImage: (import.meta.env.VITE_CUSTOM_REST_IMAGE as string | undefined) || _v3.symbolRestImage,
      symbolServerToolsImage: (import.meta.env.VITE_CUSTOM_TOOLS_IMAGE as string | undefined) || image,
      needsOpenSslPatch: false,
      configPatches: _v3.configPatches,
    });
  });
}

// ---------------------------------------------------------------------------
// Field metadata types
// ---------------------------------------------------------------------------

export type FieldType = 'text' | 'number' | 'boolean' | 'select' | 'textarea';

export interface FieldMeta {
  key: string;
  label: string;
  type: FieldType;
  description: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  autoGenOnBootstrap?: boolean;
  /** true = 公式ネットワーク(mainnet/testnet)参加時もユーザーが変更できるノードローカル設定 */
  editableOnPublicNetwork?: boolean;
}

export interface CategoryMeta {
  id: string;
  label: string;
  icon?: string;
  description: string;
  fields: FieldMeta[];
  /** true = ネットワークレベル設定。変更にはFull Resetが必要 */
  requiresFullReset?: boolean;
  /** true = 公式ネットワーク(mainnet/testnet)参加時もサイドバーに表示するカテゴリ */
  visibleOnPublicNetwork?: boolean;
  /** true = カスタムサーバーイメージ(catapultVersion=custom*)選択時のみ表示 */
  customOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Node / Gateway types
// ---------------------------------------------------------------------------

export interface NodeConfig {
  [key: string]: unknown;
  name: string;
  host: string;
  peerNodeUrls: string;
  friendlyName: string;
  roles: string;
  harvesting: boolean;
  api: boolean;
  voting: boolean;
  database: boolean;
  minFeeMultiplier: number;
  enableTransactionSpamThrottling: boolean;
  transactionSpamThrottlingMaxBoostFee: number;
  maxTrackedNodes: number;
  trustedHosts: string;
  localNetworks: string;
}

export interface GatewayConfig {
  [key: string]: unknown;
  apiNodeName: string;
  host: string;
  port: number;
  databaseHost: string;
  throttlingBurst: number;
  throttlingRate: number;
}

// ---------------------------------------------------------------------------
// Inflation entry type
// ---------------------------------------------------------------------------

export interface InflationEntry {
  startHeight: number;
  amount: string;
}

export interface NemesisMosaic {
  name: string;
  divisibility: number;
  duration: number;
  supply: string;
  isTransferable: boolean;
  isSupplyMutable: boolean;
  isRestrictable: boolean;
}

// ---------------------------------------------------------------------------
// Complete preset config type
// ---------------------------------------------------------------------------

export interface PresetConfig {
  [key: string]: unknown;

  // General
  catapultVersion: string;
  preset: string;
  assembly: string;
  networkType: string;
  networkIdentifier: number;
  networkName: string;
  friendlyName: string;
  sourceNodeUrl: string;
  nemesisGenerationHashSeed: string;
  nemesisSignerPublicKey: string;
  nodeEqualityStrategy: string;
  epochAdjustment: string;
  currencyMosaicId: string;
  harvestingMosaicId: string;
  privateKeySecurityMode: string;

  // Certificates
  caCertificateExpirationInDays: number;
  nodeCertificateExpirationInDays: number;
  certificateExpirationWarningInDays: number;

  // Images
  symbolServerImage: string;
  symbolRestImage: string;
  symbolServerToolsImage: string;
  symbolExplorerImage: string;
  symbolFaucetImage: string;
  symbolAgentImage: string;

  // Block Generation & Chain
  enableVerifiableState: boolean;
  enableVerifiableReceipts: boolean;
  blockGenerationTargetTime: string;
  blockTimeSmoothingFactor: number;
  maxBlockFutureTime: string;
  importanceGrouping: number;
  importanceActivityPercentage: number;
  maxRollbackBlocks: number;
  maxDifficultyBlocks: number;
  maxTransactionsPerBlock: number;
  maxBlockCacheSize: string;
  totalChainImportance: string;
  initialCurrencyAtomicUnits: string;
  maxMosaicAtomicUnits: string;

  // Fees
  defaultDynamicFeeMultiplier: number;
  maxTransactionLifetime: string;

  // Harvesting
  minHarvesterBalance: string;
  maxHarvesterBalance: string;
  harvestBeneficiaryPercentage: number;
  harvestNetworkPercentage: number;
  harvestNetworkFeeSinkAddress: string;
  harvestNetworkFeeSinkAddressV1: string;

  // Voting
  minVoterBalance: string;
  votingSetGrouping: number;
  maxVotingKeysPerAccount: number;
  minVotingKeyLifetime: number;
  maxVotingKeyLifetime: number;

  // Aggregate
  maxTransactionsPerAggregate: number;
  maxCosignaturesPerAggregate: number;
  enableStrictCosignatureCheck: boolean;
  enableBondedAggregateSupport: boolean;
  maxBondedTransactionLifetime: string;

  // Hash Lock
  lockedFundsPerAggregate: string;
  maxHashLockDuration: string;

  // Secret Lock
  maxSecretLockDuration: string;
  minProofSize: number;
  maxProofSize: number;

  // Metadata
  maxValueSize: number;

  // Mosaic
  maxMosaicsPerAccount: number;
  maxMosaicDuration: string;
  maxMosaicDivisibility: number;
  mosaicRentalFeeSinkAddress: string;
  mosaicRentalFeeSinkAddressV1: string;
  mosaicRentalFee: string;

  // Namespace
  maxNameSize: number;
  maxNamespacesPerAccount: number;
  maxNamespaceDepth: number;
  maxChildNamespaces: number;
  minNamespaceDuration: string;
  maxNamespaceDuration: string;
  namespaceGracePeriodDuration: string;
  reservedRootNamespaceNames: string;
  namespaceRentalFeeSinkAddress: string;
  namespaceRentalFeeSinkAddressV1: string;
  rootNamespaceRentalFeePerBlock: string;
  childNamespaceRentalFee: string;

  // Multisig
  maxMultisigDepth: number;
  maxCosignatoriesPerAccount: number;
  maxCosignedAccountsPerAccount: number;

  // Restriction
  maxAccountRestrictionValues: number;
  maxMosaicRestrictionValues: number;

  // Transfer
  maxMessageSize: number;

  // Nemesis Mosaics (bootstrap only)
  baseNamespace: string;
  nemesisMosaics: NemesisMosaic[];

  // Docker Host Mode
  dockerHostMode: boolean;

  // Nodes & Gateways
  nodes: NodeConfig[];
  gateways: GatewayConfig[];

  // Inflation
  inflation: InflationEntry[];

  // Explorer / Faucet
  explorerEnabled: boolean;
  explorerPort: number;
  faucetEnabled: boolean;
  faucetPort: number;
  faucetAmount: number;
}

// ---------------------------------------------------------------------------
// Categories — drives sidebar & form rendering
// ---------------------------------------------------------------------------

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'settings',
    description: 'ネットワーク基本設定・ジェネシス情報',
    requiresFullReset: true,
    visibleOnPublicNetwork: true,
    fields: [
      { key: 'preset', label: 'Base Preset', type: 'select', description: 'symbol-bootstrap のベーステンプレート', options: [{ value: 'bootstrap', label: 'bootstrap (local dev)' }, { value: 'testnet', label: 'testnet' }, { value: 'mainnet', label: 'mainnet' }], editableOnPublicNetwork: true },
      { key: 'assembly', label: 'Assembly', type: 'select', description: 'ノードアセンブリタイプ', options: [{ value: 'dual', label: 'dual (Peer + API)' }, { value: 'peer', label: 'peer' }, { value: 'api', label: 'api' }, { value: 'demo', label: 'demo' }, { value: 'multinode', label: 'multinode' }], editableOnPublicNetwork: true },
      { key: 'networkType', label: 'Network Type', type: 'select', description: 'networkType（テキスト）と networkIdentifier（数値）は1対1対応。選択変更すると数値IDが自動設定される。アドレス生成のネットワークバイトになる。', options: [{ value: 'mainnet', label: 'mainnet — 104' }, { value: 'testnet', label: 'testnet — 152' }, { value: 'private', label: 'private — 120' }, { value: 'privateTest', label: 'privateTest — 168' }] },
      { key: 'networkName', label: 'Network Name', type: 'text', description: 'ネットワーク名' },
      { key: 'nemesisGenerationHashSeed', label: 'Generation Hash Seed', type: 'text', description: 'ジェネシスブロックのSHA3-256ハッシュ' },
      { key: 'nemesisSignerPublicKey', label: 'Nemesis Signer Public Key', type: 'text', description: 'ジェネシスブロック署名者の公開鍵' },
      { key: 'epochAdjustment', label: 'Epoch Adjustment', type: 'text', description: 'Unix epochからの秒数（末尾に s を付ける）。新規ネットワークは作成時刻に近い値を推奨', placeholder: `${_todayEpochSec}s` },
      { key: 'currencyMosaicId', label: 'Currency Mosaic ID', type: 'text', description: '基軸通貨のモザイクID', placeholder: "0x6BED'913F'A202'23F8" , autoGenOnBootstrap: true },
      { key: 'harvestingMosaicId', label: 'Harvesting Mosaic ID', type: 'text', description: 'ハーベスト用モザイクID', placeholder: "0x6BED'913F'A202'23F8" , autoGenOnBootstrap: true },
      { key: 'privateKeySecurityMode', label: 'Private Key Security', type: 'select', description: '秘密鍵保管モード', options: [{ value: 'PROMPT_MAIN', label: 'PROMPT_MAIN' }, { value: 'PROMPT_MAIN_TRANSPORT', label: 'PROMPT_MAIN_TRANSPORT' }, { value: 'ENCRYPT', label: 'ENCRYPT' }], editableOnPublicNetwork: true },
      { key: 'caCertificateExpirationInDays', label: 'CA Certificate Expiration (days)', type: 'number', description: 'CA証明書の有効期間(日) — デフォルト7300日(約20年)', min: 1, editableOnPublicNetwork: true },
      { key: 'nodeCertificateExpirationInDays', label: 'Node Certificate Expiration (days)', type: 'number', description: 'ノード証明書の有効期間(日) — デフォルト375日(約1年)', min: 1, editableOnPublicNetwork: true },
      { key: 'certificateExpirationWarningInDays', label: 'Certificate Warning (days)', type: 'number', description: '期限切れ警告を出す日数', min: 1, editableOnPublicNetwork: true },
    ],
  },
  {
    id: 'nemesisMosaics',
    label: 'ネメシスモザイク',
    icon: 'nemesisMosaics',
    description: 'ネットワーク通貨(Currency / Harvest)モザイク定義',
    requiresFullReset: true,
    fields: [
      { key: 'baseNamespace', label: 'Base Namespace', type: 'text', description: 'モザイクの基本ネームスペース', placeholder: 'cat' },
    ],
  },
  {
    id: 'images',
    label: 'Images',
    icon: 'image',
    description: 'Catapultバージョン & Dockerイメージ',
    visibleOnPublicNetwork: true,
    fields: [
      // catapultVersion is locked on official networks (mainnet/testnet are V3-only)
      { key: 'catapultVersion', label: 'Catapult Version', type: 'select', description: 'V2/V3選択でイメージ自動設定', options: CATAPULT_VERSIONS.map(v => ({ value: v.id, label: v.label })) },
      { key: 'symbolServerImage', label: 'Server Image', type: 'text', description: 'Catapultサーバーイメージ', editableOnPublicNetwork: true },
      { key: 'symbolRestImage', label: 'REST Image', type: 'text', description: 'REST Gatewayイメージ', editableOnPublicNetwork: true },
      { key: 'symbolServerToolsImage', label: 'Tools Image', type: 'text', description: 'サーバーツールイメージ', editableOnPublicNetwork: true },
      // Explorer is managed by ExplorerManager (SMD build), not via bootstrap preset image
      // Faucet/Agent images are not used in the current setup
    ],
  },
  {
    id: 'chain',
    label: 'ブロック生成・チェーン',
    icon: 'blocks',
    description: 'ブロック時間、キャッシュ、通貨供給量',
    requiresFullReset: true,
    fields: [
      { key: 'blockGenerationTargetTime', label: 'Block Generation Target Time', type: 'text', description: 'ブロック生成目標時間', placeholder: '30s' },
      { key: 'blockTimeSmoothingFactor', label: 'Smoothing Factor', type: 'number', description: '難易度スムージング係数', min: 0 },
      { key: 'maxBlockFutureTime', label: 'Max Block Future Time', type: 'text', description: '未来タイムスタンプ許容値', placeholder: '500ms' },
      { key: 'importanceGrouping', label: 'Importance Grouping', type: 'number', description: 'インポータンス再計算間隔(ブロック)', min: 1 },
      { key: 'importanceActivityPercentage', label: 'Activity %', type: 'number', description: 'アクティビティベースインポータンス割合', min: 0, max: 100 },
      { key: 'maxRollbackBlocks', label: 'Max Rollback Blocks', type: 'number', description: '最大ロールバック数(0=ファイナリティ有効)', min: 0 },
      { key: 'maxDifficultyBlocks', label: 'Max Difficulty Blocks', type: 'number', description: '難易度計算ブロック数', min: 1 },
      { key: 'maxTransactionsPerBlock', label: 'Max Txns / Block', type: 'number', description: 'ブロックあたり最大トランザクション数', min: 1 },
      { key: 'maxBlockCacheSize', label: 'Max Block Cache', type: 'text', description: 'キャッシュメモリ上限', placeholder: '10MB' },
      { key: 'totalChainImportance', label: 'Total Chain Importance', type: 'text', description: '⚠️ ネットワーク全体インポータンス。nemesis ブロック生成時の harvesting outflows ÷ この値が 10 の冪乗（1, 10, 100…）でなければ起動不可。デフォルト値推奨。変更には Full Reset が必要。' },
      { key: 'initialCurrencyAtomicUnits', label: 'Initial Supply', type: 'text', description: '初期通貨供給量(atomic)' },
      { key: 'maxMosaicAtomicUnits', label: 'Max Mosaic Units', type: 'text', description: 'モザイク供給最大値' },
      { key: 'enableVerifiableState', label: 'Verifiable State', type: 'boolean', description: '検証可能状態を有効化' },
      { key: 'enableVerifiableReceipts', label: 'Verifiable Receipts', type: 'boolean', description: '検証可能レシートを有効化' },
    ],
  },
  {
    id: 'fees',
    label: '手数料',
    icon: 'fees',
    description: 'トランザクション手数料・有効期間',
    requiresFullReset: true,
    fields: [
      { key: 'defaultDynamicFeeMultiplier', label: 'Default Fee Multiplier', type: 'number', description: 'デフォルト動的手数料乗数', min: 0 },
      { key: 'maxTransactionLifetime', label: 'Max Transaction Lifetime', type: 'text', description: '未確認Txの最大有効期間', placeholder: '6h' },
    ],
  },
  {
    id: 'harvesting',
    label: 'ハーベスト',
    icon: 'harvest',
    description: '資格残高・報酬分配・ネットワーク手数料シンク',
    requiresFullReset: true,
    fields: [
      { key: 'minHarvesterBalance', label: 'Min Harvester Balance', type: 'text', description: 'ハーベスト資格の最小残高' },
      { key: 'maxHarvesterBalance', label: 'Max Harvester Balance', type: 'text', description: 'インポータンス計算の最大残高' },
      { key: 'harvestBeneficiaryPercentage', label: 'Beneficiary %', type: 'number', description: 'ノードオーナーへの報酬割合', min: 0, max: 100 },
      { key: 'harvestNetworkPercentage', label: 'Network %', type: 'number', description: 'ネットワークシンクへの報酬割合', min: 0, max: 100 },
      { key: 'harvestNetworkFeeSinkAddress', label: 'Fee Sink Address', type: 'text', description: 'ネットワーク手数料受信アドレス' },
      { key: 'harvestNetworkFeeSinkAddressV1', label: 'Fee Sink Address V1', type: 'text', description: 'V1互換シンクアドレス' },
    ],
  },
  {
    id: 'voting',
    label: '投票・ファイナリティ',
    icon: 'voting',
    description: '投票キー・ファイナライゼーション設定',
    requiresFullReset: true,
    fields: [
      { key: 'minVoterBalance', label: 'Min Voter Balance', type: 'text', description: '投票資格の最小残高' },
      { key: 'votingSetGrouping', label: 'Voting Set Grouping', type: 'number', description: '投票セットグルーピング(ブロック数)', min: 1 },
      { key: 'maxVotingKeysPerAccount', label: 'Max Voting Keys', type: 'number', description: 'アカウントあたり同時投票キー数', min: 1 },
      { key: 'minVotingKeyLifetime', label: 'Min Key Lifetime', type: 'number', description: '投票キー最小寿命(エポック数)', min: 1 },
      { key: 'maxVotingKeyLifetime', label: 'Max Key Lifetime', type: 'number', description: '投票キー最大寿命(エポック数)', min: 1 },
    ],
  },
  {
    id: 'aggregate',
    label: 'アグリゲート',
    icon: 'aggregate',
    description: 'アグリゲートTx・連署設定',
    requiresFullReset: true,
    fields: [
      { key: 'maxTransactionsPerAggregate', label: 'Max Txns / Aggregate', type: 'number', description: 'アグリゲート内の最大Tx数', min: 1 },
      { key: 'maxCosignaturesPerAggregate', label: 'Max Cosignatures / Aggregate', type: 'number', description: 'アグリゲートあたりの最大連署数', min: 1 },
      { key: 'maxBondedTransactionLifetime', label: 'Max Bonded Lifetime', type: 'text', description: 'ボンドアグリゲートの最大有効期間', placeholder: '48h' },
      { key: 'enableStrictCosignatureCheck', label: 'Strict Cosignature Check', type: 'boolean', description: '厳密な連署チェック' },
      { key: 'enableBondedAggregateSupport', label: 'Bonded Aggregate Support', type: 'boolean', description: 'ボンドアグリゲートを有効化' },
    ],
  },
  {
    id: 'hashlock',
    label: 'ハッシュロック',
    icon: 'lock',
    description: 'ボンドアグリゲート用ハッシュロック',
    requiresFullReset: true,
    fields: [
      { key: 'lockedFundsPerAggregate', label: 'Locked Funds / Aggregate', type: 'text', description: 'アグリゲートボンドごとのロック額' },
      { key: 'maxHashLockDuration', label: 'Max Duration', type: 'text', description: 'ハッシュロック最大期間', placeholder: '2d' },
    ],
  },
  {
    id: 'secretlock',
    label: 'シークレットロック',
    icon: 'secretlock',
    description: 'クロスチェーンスワップ用ロック',
    requiresFullReset: true,
    fields: [
      { key: 'maxSecretLockDuration', label: 'Max Duration', type: 'text', description: 'シークレットロック最大期間', placeholder: '365d' },
      { key: 'minProofSize', label: 'Min Proof Size', type: 'number', description: 'プルーフ最小サイズ(bytes)', min: 0 },
      { key: 'maxProofSize', label: 'Max Proof Size', type: 'number', description: 'プルーフ最大サイズ(bytes)', min: 0 },
    ],
  },
  {
    id: 'metadata',
    label: 'メタデータ',
    icon: 'metadata',
    description: 'メタデータ値の最大サイズ',
    requiresFullReset: true,
    fields: [
      { key: 'maxValueSize', label: 'Max Value Size', type: 'number', description: 'メタデータ値の最大バイト数', min: 0 },
    ],
  },
  {
    id: 'mosaic',
    label: 'モザイク',
    icon: 'mosaic',
    description: 'モザイク(トークン) リミット・レンタル手数料。実効手数料 = ベース値 × minFeeMultiplier ÷ 1,000,000 (minFeeMultiplier=0 のとき無料)。',
    requiresFullReset: true,
    fields: [
      { key: 'maxMosaicsPerAccount', label: 'Max / Account', type: 'number', description: 'アカウントあたり最大モザイク数', min: 1 },
      { key: 'maxMosaicDuration', label: 'Max Duration', type: 'text', description: 'モザイク最大有効期間', placeholder: '3650d' },
      { key: 'maxMosaicDivisibility', label: 'Max Divisibility', type: 'number', description: '最大小数桁数', min: 0, max: 6 },
      { key: 'mosaicRentalFeeSinkAddress', label: 'Rental Fee Sink', type: 'text', description: 'モザイクレンタル手数料受信アドレス' },
      { key: 'mosaicRentalFeeSinkAddressV1', label: 'Rental Fee Sink V1', type: 'text', description: 'V1互換シンクアドレス' },
      { key: 'mosaicRentalFee', label: 'Rental Fee (Base)', type: 'text', description: 'モザイク作成時レンタル手数料(ベース値)。実際に徴収される額 = この値 × ノードの minFeeMultiplier ÷ 1,000,000。minFeeMultiplier=0 なら無料。変更には Full Reset が必要。' },
    ],
  },
  {
    id: 'namespace',
    label: 'ネームスペース',
    icon: 'namespace',
    description: '深さ・期間・レンタル手数料。実効手数料 = ベース値 × minFeeMultiplier ÷ 1,000,000 (minFeeMultiplier=0 のとき無料)。',
    requiresFullReset: true,
    fields: [
      { key: 'maxNameSize', label: 'Max Name Size', type: 'number', description: '名前の最大文字数', min: 1 },
      { key: 'maxNamespacesPerAccount', label: 'Max / Account', type: 'number', description: 'アカウントあたり最大数', min: 1 },
      { key: 'maxNamespaceDepth', label: 'Max Depth', type: 'number', description: 'サブNS最大深度', min: 1 },
      { key: 'maxChildNamespaces', label: 'Max Children', type: 'number', description: 'ルートあたり子NS最大数', min: 1 },
      { key: 'minNamespaceDuration', label: 'Min Duration', type: 'text', description: 'NS最小期間', placeholder: '1m' },
      { key: 'maxNamespaceDuration', label: 'Max Duration', type: 'text', description: 'NS最大期間', placeholder: '365d' },
      { key: 'namespaceGracePeriodDuration', label: 'Grace Period', type: 'text', description: '失効後猶予期間', placeholder: '30d' },
      { key: 'reservedRootNamespaceNames', label: 'Reserved Names', type: 'text', description: '予約済みルート名(カンマ区切り)' },
      { key: 'namespaceRentalFeeSinkAddress', label: 'Rental Fee Sink', type: 'text', description: 'レンタル手数料受信アドレス' },
      { key: 'namespaceRentalFeeSinkAddressV1', label: 'Rental Fee Sink V1', type: 'text', description: 'V1互換シンクアドレス' },
      { key: 'rootNamespaceRentalFeePerBlock', label: 'Root Fee / Block (Base)', type: 'text', description: 'ルートNS の 1ブロックあたり手数料(ベース値)。実効額 = この値 × minFeeMultiplier ÷ 1,000,000。minFeeMultiplier=0 なら無料。変更には Full Reset が必要。' },
      { key: 'childNamespaceRentalFee', label: 'Child Rental Fee (Base)', type: 'text', description: '子NS作成時手数料(ベース値)。実効額 = この値 × minFeeMultiplier ÷ 1,000,000。minFeeMultiplier=0 なら無料。変更には Full Reset が必要。' },
    ],
  },
  {
    id: 'multisig',
    label: 'マルチシグ',
    icon: 'multisig',
    description: 'マルチシグの深さ・連署者数制限',
    requiresFullReset: true,
    fields: [
      { key: 'maxMultisigDepth', label: 'Max Depth', type: 'number', description: 'マルチシグネスト最大深度', min: 1 },
      { key: 'maxCosignatoriesPerAccount', label: 'Max Cosignatories / Account', type: 'number', description: '最大連署者数', min: 1 },
      { key: 'maxCosignedAccountsPerAccount', label: 'Max Cosigned Accounts', type: 'number', description: '連署可能な最大アカウント数', min: 1 },
    ],
  },
  {
    id: 'restriction',
    label: '制限(Restriction)',
    icon: 'restriction',
    description: 'アカウント・モザイク制限の値数',
    requiresFullReset: true,
    fields: [
      { key: 'maxAccountRestrictionValues', label: 'Max Account Values', type: 'number', description: 'アカウント制限あたり最大値数', min: 1 },
      { key: 'maxMosaicRestrictionValues', label: 'Max Mosaic Values', type: 'number', description: 'モザイク制限あたり最大値数', min: 1 },
    ],
  },
  {
    id: 'transfer',
    label: 'トランスファー',
    icon: 'transfer',
    description: '転送メッセージサイズ',
    requiresFullReset: true,
    fields: [
      { key: 'maxMessageSize', label: 'Max Message Size', type: 'number', description: '転送メッセージ最大バイト数', min: 0 },
    ],
  },
  {
    id: 'inflation',
    label: 'インフレーション',
    icon: 'inflation',
    description: 'ブロック報酬(インフレーション)スケジュール',
    requiresFullReset: true,
    fields: [],
  },
  {
    id: 'nodes',
    label: 'Nodes',
    icon: 'nodes',
    description: 'ピア / API / 投票ノード設定',
    visibleOnPublicNetwork: true,
    fields: [
      { key: 'dockerHostMode', label: 'Docker Host Network Mode', type: 'boolean', description: 'catapultコンテナをDockerホストネットワークで実行。外部ピアのIPアドレスがDNATで書き換えられず正しく認識されるため、3台以上のネットワーク構成で推奨。変更はノード再起動のみで反映。', editableOnPublicNetwork: true },
      { key: 'nodeEqualityStrategy', label: 'Node Equality Strategy', type: 'select', description: 'ノード同一性の判定方法。public-key: 公開鍵で識別（Docker NAT環境・同一サーバー上の複数ノードや動的IPに対応）。host: IPアドレスで識別（固定IP・シンプルな構成向け）。変更はノード再起動のみで反映（Full Reset 不要）。', options: [{ value: 'public-key', label: 'public-key' }, { value: 'host', label: 'host' }], editableOnPublicNetwork: true },
    ],
  },
  {
    id: 'gateways',
    label: 'Gateways',
    icon: 'gateways',
    description: 'REST Gatewayインスタンス',
    visibleOnPublicNetwork: true,
    fields: [],
  },
  {
    id: 'explorer',
    label: 'Explorer / Faucet',
    icon: 'explorer',
    description: 'エクスプローラー & Faucet',
    visibleOnPublicNetwork: true,
    fields: [
      { key: 'explorerEnabled', label: 'Enable Explorer', type: 'boolean', description: 'エクスプローラーをデプロイ', editableOnPublicNetwork: true },
      { key: 'explorerPort', label: 'Explorer Port', type: 'number', description: 'エクスプローラーポート', min: 1, max: 65535, editableOnPublicNetwork: true },
      { key: 'faucetEnabled', label: 'Enable Faucet', type: 'boolean', description: 'Faucetをデプロイ', editableOnPublicNetwork: true },
      { key: 'faucetPort', label: 'Faucet Port', type: 'number', description: 'Faucetポート', min: 1, max: 65535, editableOnPublicNetwork: true },
      { key: 'faucetAmount', label: 'Faucet Amount', type: 'number', description: '1回あたり配布額(atomic)', min: 0, editableOnPublicNetwork: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Custom config patches (VITE_CUSTOM_CONFIG_PATCHES) — カスタムサーバーイメージ
// テスト用の追加プロパティを Configuration UI で編集可能にする。
// 書式はバックエンドの CUSTOM_CONFIG_PATCHES と同一:
//   <file>:[<section>]:<key>=<value>   （複数は ; または改行区切り）
// docker-compose が CUSTOM_CONFIG_PATCHES を VITE_ 名でも転送するため、
// .env の設定は1箇所で済む。値が空のフィールドは .env の既定値が使われる。
// カテゴリは catapultVersion=custom* 選択時のみ表示（ConfigForm 側で制御）。
// ---------------------------------------------------------------------------
export interface CustomPatchField {
  file: string;
  section: string;
  key: string;
  defaultValue: string;
}

// Built-in patch fields for known BNL server images (mirrors the backend's
// BNL_IMAGE_BUILTIN_PATCHES): listing one of these images in
// VITE_CUSTOM_SERVER_IMAGE makes its properties editable here without any
// VITE_CUSTOM_CONFIG_PATCHES. Ordered most-specific first; first match wins.
const BNL_IMAGE_BUILTIN_PATCH_FIELDS: { pattern: RegExp; fields: CustomPatchField[] }[] = [
  {
    // chainFinalization + emptyBlockPolicy edition (e.g. nftdrive/bnl-catapult-server:1.0.3.9-cf1-ebp)
    pattern: /bnl-catapult-server:\S*-ebp$/,
    fields: [
      { file: 'config-network.properties', section: '[chain]', key: 'chainFinalizationHeight', defaultValue: '0' },
      { file: 'config-network.properties', section: '[chain]', key: 'emptyBlockPolicy', defaultValue: 'heartbeat' },
      { file: 'config-network.properties', section: '[chain]', key: 'emptyBlockHeartbeatInterval', defaultValue: '86400s' },
    ],
  },
  {
    // chainFinalization edition (e.g. nftdrive/bnl-catapult-server:1.0.3.9-cf1)
    pattern: /bnl-catapult-server:\S*-cf\d*$/,
    fields: [
      { file: 'config-network.properties', section: '[chain]', key: 'chainFinalizationHeight', defaultValue: '0' },
    ],
  },
];

const _envPatchFields: CustomPatchField[] =
  (((import.meta.env.VITE_CUSTOM_CONFIG_PATCHES as string | undefined) ?? '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^([^:]+):(\[[^\]]+\]):([^=]+)=(.*)$/);
      if (!m) return null;
      return { file: m[1].trim(), section: m[2].trim(), key: m[3].trim(), defaultValue: m[4].trim() };
    })
    .filter(Boolean)) as CustomPatchField[];

const _builtinPatchFields: CustomPatchField[] = ((import.meta.env.VITE_CUSTOM_SERVER_IMAGE as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .flatMap((image) => BNL_IMAGE_BUILTIN_PATCH_FIELDS.find((e) => e.pattern.test(image))?.fields ?? []);

// built-in fields first (deduped), then env fields; an env entry for the same
// file/section/key replaces the built-in default (mirrors the backend merge)
export const CUSTOM_CONFIG_PATCH_FIELDS: CustomPatchField[] = [
  ..._builtinPatchFields.filter((b, idx, arr) =>
    idx === arr.findIndex((x) => x.file === b.file && x.section === b.section && x.key === b.key)
    && !_envPatchFields.some((e) => e.file === b.file && e.section === b.section && e.key === b.key)),
  ..._envPatchFields,
];

if (CUSTOM_CONFIG_PATCH_FIELDS.length > 0) {
  CATEGORIES.unshift({
    id: 'customConfig',
    label: 'カスタム設定',
    icon: 'settings',
    description: 'カスタムサーバーイメージ用の追加プロパティ（既知の BNL イメージは自動定義、CUSTOM_CONFIG_PATCHES で追加・上書き可）',
    customOnly: true,
    fields: CUSTOM_CONFIG_PATCH_FIELDS.map((f) => (
      'emptyBlockPolicy' === f.key
        ? {
          key: f.key,
          label: f.key,
          type: 'select' as FieldType,
          description: `${f.file} ${f.section} に注入されます。空ブロック抑制ポリシー。未入力時は既定値（${f.defaultValue}）。`,
          options: [
            { value: 'normal', label: 'normal — 常に生成(従来)' },
            { value: 'suppress', label: 'suppress — 空ブロック生成しない' },
            { value: 'heartbeat', label: 'heartbeat — 一定間隔のみ生成(推奨)' },
          ],
        }
        : {
          key: f.key,
          label: f.key,
          type: 'text' as FieldType,
          description: `${f.file} ${f.section} に注入されます。未入力時は既定値（${f.defaultValue || '空'}）を使用。`,
          placeholder: f.defaultValue,
        })),
  });
}

// ---------------------------------------------------------------------------
// Node / Gateway field metadata
// ---------------------------------------------------------------------------

export const NODE_FIELDS: FieldMeta[] = [
  { key: 'name', label: 'Node Name', type: 'text', description: 'ノード識別子' },
  { key: 'host', label: 'Host', type: 'text', description: '他ノードから到達できるIPアドレスまたはFQDN（必須）。0.0.0.0 は無効。LAN内なら 192.168.x.x、インターネット公開ならグローバルIPまたはドメイン名', placeholder: '192.168.0.x or example.com' },
  { key: 'peerNodeUrls', label: 'Peer Node URLs', type: 'textarea', description: '接続先ピアのREST URL(改行 or カンマ区切り, 例: http://192.168.1.10:3000)' },
  { key: 'friendlyName', label: 'Friendly Name', type: 'text', description: '表示名' },
  { key: 'roles', label: 'Roles', type: 'select', description: 'ロール', options: [{ value: 'Peer', label: 'Peer' }, { value: 'Api', label: 'Api' }, { value: 'Peer,Api', label: 'Peer + Api' }, { value: 'Peer,Voting', label: 'Peer + Voting' }, { value: 'Peer,Api,Voting', label: 'Peer + Api + Voting' }] },
  { key: 'harvesting', label: 'Harvesting', type: 'boolean', description: 'ハーベスト有効' },
  { key: 'api', label: 'API', type: 'boolean', description: 'REST API有効' },
  { key: 'voting', label: 'Voting', type: 'boolean', description: '投票有効' },
  { key: 'database', label: 'Database', type: 'boolean', description: 'MongoDB実行' },
  { key: 'minFeeMultiplier', label: 'Min Fee Multiplier', type: 'number', description: '最小手数料乗数。0 = 全手数料無料(モザイク・NS レンタル含む)。実効レンタル手数料 = ベース値 × この値 ÷ 1,000,000。ノード再起動のみで反映(Full Reset 不要)。', min: 0 },
  { key: 'enableTransactionSpamThrottling', label: 'Spam Throttling', type: 'boolean', description: 'Txスパム制御を有効化' },
  { key: 'transactionSpamThrottlingMaxBoostFee', label: 'Spam Max Boost Fee', type: 'number', description: 'スパム判定の最大ブースト手数料', min: 0 },
  { key: 'maxTrackedNodes', label: 'Max Tracked Nodes', type: 'number', description: 'ピア追跡上限', min: 1 },
  { key: 'trustedHosts', label: 'Trusted Hosts', type: 'text', description: '信頼ホスト(カンマ区切り)' },
  { key: 'localNetworks', label: 'Local Networks', type: 'text', description: 'ローカルCIDR(カンマ区切り)' },
];

export const GATEWAY_FIELDS: FieldMeta[] = [
  { key: 'apiNodeName', label: 'API Node Name', type: 'text', description: '接続先APIノード名' },
  { key: 'host', label: 'Host', type: 'text', description: 'Dockerネットワーク内の接続先ノード名（コンテナサービス名 = apiNodeName と同値）。外部公開アドレス不可' },
  { key: 'port', label: 'Port', type: 'number', description: 'ポート', min: 1, max: 65535 },
  { key: 'databaseHost', label: 'DB Host', type: 'text', description: 'MongoDBホスト' },
  { key: 'throttlingBurst', label: 'Throttle Burst', type: 'number', description: 'バースト上限', min: 1 },
  { key: 'throttlingRate', label: 'Throttle Rate', type: 'number', description: 'レート上限', min: 1 },
];

export const INFLATION_FIELDS: FieldMeta[] = [
  { key: 'startHeight', label: 'Starting Height', type: 'number', description: '適用開始ブロック高', min: 2 },
  { key: 'amount', label: 'Amount (per block)', type: 'text', description: 'ブロックあたりの報酬額 (atomic単位)' },
];

export const DEFAULT_INFLATION_ENTRY: InflationEntry = {
  startHeight: 2,
  amount: '0',
};

export const NEMESIS_MOSAIC_FIELDS: FieldMeta[] = [
  { key: 'name', label: 'Mosaic Name', type: 'text', description: 'モザイク名 (namespace.name の name 部分)', placeholder: 'currency' },
  { key: 'divisibility', label: 'Divisibility', type: 'number', description: '小数桁数', min: 0, max: 6 },
  { key: 'duration', label: 'Duration', type: 'number', description: '有効期間 (ブロック数, 0 = 永続)', min: 0 },
  { key: 'supply', label: 'Supply', type: 'text', description: '総供給量 (atomic単位)' },
  { key: 'isTransferable', label: 'Transferable', type: 'boolean', description: '転送可能' },
  { key: 'isSupplyMutable', label: 'Supply Mutable', type: 'boolean', description: '供給量変更可能' },
  { key: 'isRestrictable', label: 'Restrictable', type: 'boolean', description: '制限設定可能' },
];

export const DEFAULT_CURRENCY_MOSAIC: NemesisMosaic = {
  name: 'currency',
  divisibility: 6,
  duration: 0,
  supply: '8998999998000000',
  isTransferable: true,
  isSupplyMutable: false,
  isRestrictable: false,
};

export const DEFAULT_HARVEST_MOSAIC: NemesisMosaic = {
  name: 'harvest',
  divisibility: 3,
  duration: 0,
  supply: '15000000',
  isTransferable: true,
  isSupplyMutable: true,
  isRestrictable: false,
};

// ---------------------------------------------------------------------------
// Default templates
// ---------------------------------------------------------------------------

export const DEFAULT_NODE: NodeConfig = {
  name: 'api-node-0',
  host: '',
  peerNodeUrls: '',
  friendlyName: 'My API Node',
  roles: 'Peer,Api,Voting',
  harvesting: true,
  api: true,
  voting: true,
  database: true,
  minFeeMultiplier: 100,
  enableTransactionSpamThrottling: true,
  transactionSpamThrottlingMaxBoostFee: 10000000,
  maxTrackedNodes: 5000,
  trustedHosts: '127.0.0.1',
  localNetworks: '127.0.0.1',
};

export const DEFAULT_GATEWAY: GatewayConfig = {
  apiNodeName: 'api-node-0',
  host: 'api-node-0',
  port: 3000,
  databaseHost: 'db',
  throttlingBurst: 80,
  throttlingRate: 60,
};

// ---------------------------------------------------------------------------
// Official Symbol network generation hash seeds
// These are unique to each genesis block and used to distinguish official
// mainnet/testnet from bootstrap custom networks that reuse the same
// networkIdentifier (e.g. a custom network with identifier=152 must NOT
// be treated as Symbol's official testnet).
// ---------------------------------------------------------------------------
export const OFFICIAL_MAINNET_GENERATION_HASH =
  '57F7DA205008026C776CB6AED843393F04CD458E0AA2D9F1D5F31A402072B2D6';
export const OFFICIAL_TESTNET_GENERATION_HASH =
  '49D6E1CE276A85B70EAFE52349AACCA389302E7A9754BCF1221E79494FC665A4';

// preset name is only ever 'mainnet'/'testnet' for the official networks —
// custom networks that reuse those identifiers resolve to 'bootstrap' via
// the generation-hash check above (see lib/utils networkPropertiesToConfig).
export const isPublicNetworkPreset = (preset: string): boolean =>
  preset === 'mainnet' || preset === 'testnet';

// ---------------------------------------------------------------------------
// Preset overrides
// ---------------------------------------------------------------------------

export const PRESET_OVERRIDES: Record<string, Partial<PresetConfig>> = {
  mainnet: {
    catapultVersion: 'v3',
    symbolServerImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    symbolRestImage: 'symbolplatform/symbol-rest:2.4.4',
    symbolServerToolsImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    networkType: 'mainnet', networkIdentifier: 104, networkName: 'mainnet', friendlyName: 'mainnet',
    nemesisGenerationHashSeed: '57F7DA205008026C776CB6AED843393F04CD458E0AA2D9F1D5F31A402072B2D6',
    epochAdjustment: '1615853185s',
    currencyMosaicId: "0x6BED'913F'A202'23F8", harvestingMosaicId: "0x6BED'913F'A202'23F8",
    totalChainImportance: "7'842'928'625'000'000", initialCurrencyAtomicUnits: "7'842'928'625'000'000",
    minHarvesterBalance: "10'000'000'000", maxHarvesterBalance: "50'000'000'000'000",
    minVoterBalance: "3'000'000'000'000",
    harvestBeneficiaryPercentage: 25, harvestNetworkPercentage: 5,
    harvestNetworkFeeSinkAddress: 'NAMQ5ZYL2QDMO6OHNKL7KGV2VBKDNBCJ7BUVAY',
    maxTransactionsPerAggregate: 100, maxCosignaturesPerAggregate: 25,
    maxTransactionsPerBlock: 6000, blockGenerationTargetTime: '30s',
    importanceGrouping: 720, maxRollbackBlocks: 0, maxDifficultyBlocks: 60,
    maxVotingKeysPerAccount: 3, minVotingKeyLifetime: 72, maxVotingKeyLifetime: 720,
    maxMosaicsPerAccount: 1000, maxMosaicDuration: '3650d', maxMosaicDivisibility: 6,
    maxNamespacesPerAccount: 25, maxNamespaceDepth: 3, maxChildNamespaces: 256,
    namespaceGracePeriodDuration: '30d', lockedFundsPerAggregate: "10'000'000", maxMessageSize: 1024,
  },
  testnet: {
    catapultVersion: 'v3',
    symbolServerImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    symbolRestImage: 'symbolplatform/symbol-rest:2.4.4',
    symbolServerToolsImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
    networkType: 'testnet', networkIdentifier: 152, networkName: 'testnet', friendlyName: 'testnet',
    nemesisGenerationHashSeed: '49D6E1CE276A85B70EAFE52349AACCA389302E7A9754BCF1221E79494FC665A4',
    epochAdjustment: '1667250467s',
    currencyMosaicId: "0x72C0'212E'67A0'8BCE", harvestingMosaicId: "0x72C0'212E'67A0'8BCE",
    totalChainImportance: "7'842'928'625'000'000", initialCurrencyAtomicUnits: "7'842'928'625'000'000",
    minHarvesterBalance: "10'000'000'000", maxHarvesterBalance: "50'000'000'000'000",
    minVoterBalance: "3'000'000'000'000",
    harvestBeneficiaryPercentage: 25, harvestNetworkPercentage: 5,
    harvestNetworkFeeSinkAddress: 'TDGY4DD2U4YQQGERFMDQYHPYS6M7LHIF6XUCJ4Q',
    maxTransactionsPerAggregate: 100, maxCosignaturesPerAggregate: 25,
    maxTransactionsPerBlock: 6000, blockGenerationTargetTime: '30s',
    importanceGrouping: 720, maxRollbackBlocks: 0, maxDifficultyBlocks: 60,
    maxVotingKeysPerAccount: 3, minVotingKeyLifetime: 72, maxVotingKeyLifetime: 720,
    maxMosaicsPerAccount: 1000, maxMosaicDuration: '3650d', maxMosaicDivisibility: 6,
    maxNamespacesPerAccount: 25, maxNamespaceDepth: 3, maxChildNamespaces: 256,
    namespaceGracePeriodDuration: '30d', lockedFundsPerAggregate: "10'000'000", maxMessageSize: 1024,
  },
  bootstrap: {
    networkType: 'privateTest', networkIdentifier: 168,
    networkName: 'custom-symbol-network', friendlyName: 'custom-network',
    nemesisGenerationHashSeed: '', epochAdjustment: '1573430400s',
    currencyMosaicId: '', harvestingMosaicId: '',
    baseNamespace: 'cat',
    nemesisMosaics: [
      { name: 'currency', divisibility: 6, duration: 0, supply: '8998999998000000', isTransferable: true, isSupplyMutable: false, isRestrictable: false },
      { name: 'harvest', divisibility: 3, duration: 0, supply: '15000000', isTransferable: true, isSupplyMutable: true, isRestrictable: false },
    ],
    totalChainImportance: "15'000'000", initialCurrencyAtomicUnits: "8'998'999'998'000'000",
    maxMosaicAtomicUnits: "9'000'000'000'000'000",
    minHarvesterBalance: "500", maxHarvesterBalance: "50'000'000'000'000",
    minVoterBalance: "50'000", votingSetGrouping: 720,
    harvestBeneficiaryPercentage: 25, harvestNetworkPercentage: 5, harvestNetworkFeeSinkAddress: '',
    maxTransactionsPerAggregate: 100, maxCosignaturesPerAggregate: 25,
    maxTransactionsPerBlock: 6000, blockGenerationTargetTime: '30s',
    importanceGrouping: 720, maxRollbackBlocks: 0, maxDifficultyBlocks: 60,
    maxVotingKeysPerAccount: 3, minVotingKeyLifetime: 28, maxVotingKeyLifetime: 720,
    maxMosaicsPerAccount: 1000, maxMosaicDuration: '3650d', maxMosaicDivisibility: 6,
    maxNamespacesPerAccount: 25, maxNamespaceDepth: 3, maxChildNamespaces: 256,
    namespaceGracePeriodDuration: '30d', lockedFundsPerAggregate: "10'000'000", maxMessageSize: 1024,
  },
};

// ---------------------------------------------------------------------------
// DEFAULT PRESET
// ---------------------------------------------------------------------------

export const DEFAULT_PRESET: PresetConfig = {
  catapultVersion: 'v3', preset: 'bootstrap', assembly: 'dual',
  networkType: 'privateTest', networkIdentifier: 168,
  networkName: 'custom-symbol-network', friendlyName: 'custom-network',
  sourceNodeUrl: '', nemesisGenerationHashSeed: '', nemesisSignerPublicKey: '',
  nodeEqualityStrategy: 'public-key',
  epochAdjustment: `${_todayEpochSec}s`,
  currencyMosaicId: '', harvestingMosaicId: '',
  privateKeySecurityMode: 'ENCRYPT',

  caCertificateExpirationInDays: 7300,
  nodeCertificateExpirationInDays: 375,
  certificateExpirationWarningInDays: 30,

  symbolServerImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
  symbolRestImage: 'symbolplatform/symbol-rest:2.4.4',
  symbolServerToolsImage: 'symbolplatform/symbol-server:gcc-1.0.3.9',
  symbolExplorerImage: 'symbolplatform/symbol-explorer:1.2.1',
  symbolFaucetImage: 'symbolplatform/symbol-faucet:1.0.1',
  symbolAgentImage: 'symbolplatform/symbol-agent:1.1.1',

  enableVerifiableState: true, enableVerifiableReceipts: true,
  blockGenerationTargetTime: '30s', blockTimeSmoothingFactor: 3000,
  maxBlockFutureTime: '500ms',
  importanceGrouping: 720, importanceActivityPercentage: 5,
  maxRollbackBlocks: 0, maxDifficultyBlocks: 60,
  maxTransactionsPerBlock: 6000, maxBlockCacheSize: '10MB',
  totalChainImportance: "15'000'000",
  initialCurrencyAtomicUnits: "8'998'999'998'000'000",
  maxMosaicAtomicUnits: "9'000'000'000'000'000",

  defaultDynamicFeeMultiplier: 100, maxTransactionLifetime: '6h',

  minHarvesterBalance: "500", maxHarvesterBalance: "50'000'000'000'000",
  harvestBeneficiaryPercentage: 25, harvestNetworkPercentage: 5,
  harvestNetworkFeeSinkAddress: '', harvestNetworkFeeSinkAddressV1: '',

  minVoterBalance: "50'000", votingSetGrouping: 720,
  maxVotingKeysPerAccount: 3, minVotingKeyLifetime: 28, maxVotingKeyLifetime: 720,

  maxTransactionsPerAggregate: 100, maxCosignaturesPerAggregate: 25,
  enableStrictCosignatureCheck: false, enableBondedAggregateSupport: true,
  maxBondedTransactionLifetime: '48h',

  lockedFundsPerAggregate: "10'000'000", maxHashLockDuration: '2d',

  maxSecretLockDuration: '365d', minProofSize: 20, maxProofSize: 1024,

  maxValueSize: 1024,

  maxMosaicsPerAccount: 1000, maxMosaicDuration: '3650d', maxMosaicDivisibility: 6,
  mosaicRentalFeeSinkAddress: '', mosaicRentalFeeSinkAddressV1: '', mosaicRentalFee: '500',

  maxNameSize: 64, maxNamespacesPerAccount: 25, maxNamespaceDepth: 3, maxChildNamespaces: 256,
  minNamespaceDuration: '1m', maxNamespaceDuration: '365d', namespaceGracePeriodDuration: '30d',
  reservedRootNamespaceNames: 'symbol, symbl, xym, xem, nem, user, account, org, com, biz, net, edu, mil, gov, info, cat',
  namespaceRentalFeeSinkAddress: '', namespaceRentalFeeSinkAddressV1: '',
  rootNamespaceRentalFeePerBlock: '1', childNamespaceRentalFee: '100',

  maxMultisigDepth: 3, maxCosignatoriesPerAccount: 25, maxCosignedAccountsPerAccount: 25,

  maxAccountRestrictionValues: 512, maxMosaicRestrictionValues: 20,

  maxMessageSize: 1024,

  baseNamespace: 'cat',
  nemesisMosaics: [
    { name: 'currency', divisibility: 6, duration: 0, supply: '8998999998000000', isTransferable: true, isSupplyMutable: false, isRestrictable: false },
    { name: 'harvest', divisibility: 3, duration: 0, supply: '15000000', isTransferable: true, isSupplyMutable: true, isRestrictable: false },
  ],

  dockerHostMode: false,

  nodes: [{
    name: 'api-node-0', host: '', friendlyName: 'My API Node', roles: 'Peer,Api,Voting',
    peerNodeUrls: '',
    harvesting: true, api: true, voting: true, database: true,
    minFeeMultiplier: 100, enableTransactionSpamThrottling: true, transactionSpamThrottlingMaxBoostFee: 10000000,
    maxTrackedNodes: 5000, trustedHosts: '127.0.0.1', localNetworks: '127.0.0.1',
  }],
  gateways: [{
    apiNodeName: 'api-node-0', host: 'api-node-0', port: 3000, databaseHost: 'db',
    throttlingBurst: 80, throttlingRate: 60,
  }],

  inflation: [{ startHeight: 2, amount: '0' }],

  explorerEnabled: false, explorerPort: 8090,
  faucetEnabled: false, faucetPort: 4000, faucetAmount: 500000000,
};
