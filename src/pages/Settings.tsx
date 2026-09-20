/**
 * Settings.
 *
 * Language, billing assumptions, operating mode and a read-only view of the
 * thresholds the rule engine uses.
 *
 * MODE SWITCH HONESTY (spec §39): the switch to REALTIME is visible to
 * authorised users but explicitly disabled, because no hardware is connected.
 * Offering a control that silently does nothing — or worse, relabels simulated
 * data as live — would be exactly the kind of false claim the brief forbids.
 */

import { useEffect, useState } from 'react';
import { Check, Globe, Languages, Moon, Radio, Settings as SettingsIcon, Sliders, Sun } from 'lucide-react';

import type { BillingAssumptions } from '@shared/types';
import { DEFAULT_BILLING, THRESHOLDS } from '@shared/constants';
import { Metric, Panel } from '../components/ui';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { useAppDispatch, useAppSelector, usePermission } from '../store';
import { setLanguage, setTheme, type Language } from '../store/uiSlice';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

export default function Settings() {
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const theme = useAppSelector((s) => s.ui.theme);
  const user = useAppSelector((s) => s.auth.user);
  const permissions = useAppSelector((s) => s.auth.permissions);
  const canSwitchMode = usePermission('mode:switch');
  const canWriteSettings = usePermission('settings:write');
  const { snapshot, status, transport } = useTelemetry();

  const [assumptions, setAssumptions] = useState<BillingAssumptions>(DEFAULT_BILLING);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('gridsync.assumptions');
      if (raw) setAssumptions({ ...DEFAULT_BILLING, ...JSON.parse(raw) });
    } catch {
      /* defaults */
    }
  }, []);

  const saveAssumptions = () => {
    try {
      localStorage.setItem('gridsync.assumptions', JSON.stringify(assumptions));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      /* non-fatal */
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
          <SettingsIcon className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
          Settings
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Signed in as {user?.email} · {user?.role}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- language ---- */}
        <Panel title="Language" subtitle="Interface language">
          <div className="space-y-2">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => dispatch(setLanguage(lang.code as Language))}
                className={`flex w-full items-center justify-between rounded border px-3 py-2.5 text-left transition-colors ${
                  language === lang.code
                    ? 'border-primary-500 bg-primary-600/10'
                    : 'border-panel-700 bg-panel-850 hover:border-panel-600'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Languages className="h-4 w-4 text-slate-500" />
                  <span>
                    <span className="block text-xs font-medium text-slate-200">
                      {lang.nativeLabel}
                    </span>
                    <span className="block text-2xs text-slate-500">{lang.label}</span>
                  </span>
                </span>
                {language === lang.code && <Check className="h-4 w-4 text-primary-400" />}
              </button>
            ))}
          </div>

          <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
            Tamil covers navigation, common actions and primary labels. Detailed engineering text —
            rule explanations, model feature names and maintenance guidance — intentionally falls
            back to English rather than shipping an unreviewed machine translation of
            safety-relevant content.
          </p>
        </Panel>

        {/* ---- appearance ---- */}
        <Panel title="Appearance" subtitle="Light or dark interface">
          <div className="space-y-2">
            {(
              [
                { value: 'dark', label: 'Dark', icon: Moon, note: 'Control-room default' },
                { value: 'light', label: 'Light', icon: Sun, note: 'High-contrast, well-lit rooms' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => dispatch(setTheme(opt.value))}
                className={`flex w-full items-center justify-between rounded border px-3 py-2.5 text-left transition-colors ${
                  theme === opt.value
                    ? 'border-primary-500 bg-primary-600/10'
                    : 'border-panel-700 bg-panel-850 hover:border-panel-600'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <opt.icon className="h-4 w-4 text-slate-500" />
                  <span>
                    <span className="block text-xs font-medium text-slate-200">{opt.label}</span>
                    <span className="block text-2xs text-slate-500">{opt.note}</span>
                  </span>
                </span>
                {theme === opt.value && <Check className="h-4 w-4 text-primary-400" />}
              </button>
            ))}
          </div>
        </Panel>

        {/* ---- operating mode ---- */}
        <Panel title="Operating mode" subtitle="Data source for the platform">
          <div className="space-y-2">
            <div className="rounded border border-primary-500 bg-primary-600/10 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary-400" />
                  <span className="text-xs font-semibold text-primary-200">
                    Demo / Simulation
                  </span>
                </span>
                <Check className="h-4 w-4 text-primary-400" />
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-slate-500">
                Telemetry is generated by the GridSync simulation engine and labelled as such
                everywhere it appears.
              </p>
            </div>

            <div className="rounded border border-panel-700 bg-panel-850 p-3 opacity-60">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-400">Realtime / Hardware</span>
                </span>
                <span className="badge badge-neutral">Under development</span>
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-slate-600">
                The adapter, telemetry schema and MQTT source are implemented, but no physical ESP32
                nodes or Raspberry Pi edge device are connected. This mode is deliberately disabled
                rather than shown as available — switching it would not produce real data.
              </p>
            </div>
          </div>

          {!canSwitchMode && (
            <p className="mt-3 text-2xs text-slate-600">
              Your role ({user?.role}) cannot change the operating mode.
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-panel-800 pt-3">
            <Metric label="Current mode" value={snapshot?.mode ?? 'SIMULATION'} size="sm" />
            <Metric
              label="Transport"
              value={transport === 'sse' ? 'Live stream' : transport === 'poll' ? 'Polling' : status}
              size="sm"
            />
          </div>
        </Panel>

        {/* ---- assumptions ---- */}
        <Panel
          title="Billing assumptions"
          subtitle="Used by the Bill Calculator and usage reports"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={`Tariff (${assumptions.currency}/kWh)`}
              value={assumptions.tariffPerKwh}
              step={0.1}
              onChange={(v) => setAssumptions((a) => ({ ...a, tariffPerKwh: v }))}
            />
            <Field
              label={`Fixed charge (${assumptions.currency})`}
              value={assumptions.fixedCharge}
              step={10}
              onChange={(v) => setAssumptions((a) => ({ ...a, fixedCharge: v }))}
            />
            <Field
              label="Additional charge rate"
              value={assumptions.additionalChargeRate}
              step={0.01}
              onChange={(v) => setAssumptions((a) => ({ ...a, additionalChargeRate: v }))}
            />
            <Field
              label={`Diesel price (${assumptions.currency}/L)`}
              value={assumptions.dieselPricePerLitre}
              step={1}
              onChange={(v) => setAssumptions((a) => ({ ...a, dieselPricePerLitre: v }))}
            />
            <Field
              label="Generator yield (kWh/L)"
              value={assumptions.generatorKwhPerLitre}
              step={0.1}
              onChange={(v) => setAssumptions((a) => ({ ...a, generatorKwhPerLitre: v }))}
            />
            <Field
              label="Emission factor (kg/kWh)"
              value={assumptions.gridEmissionFactor}
              step={0.01}
              onChange={(v) => setAssumptions((a) => ({ ...a, gridEmissionFactor: v }))}
            />
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={saveAssumptions} className="btn btn-primary btn-sm">
              {saved ? <Check className="h-3.5 w-3.5" /> : null}
              {saved ? 'Saved' : 'Save assumptions'}
            </button>
            <button
              onClick={() => setAssumptions(DEFAULT_BILLING)}
              className="btn btn-secondary btn-sm"
            >
              Reset to defaults
            </button>
          </div>

          <p className="mt-3 text-2xs leading-relaxed text-slate-600">
            These are assumptions, not measured tariffs. They are stored in this browser and
            recorded with every report generated so a past report always reproduces its original
            figures.
          </p>
        </Panel>

        {/* ---- thresholds (read-only) ---- */}
        <Panel
          title="Rule engine thresholds"
          subtitle="Configured in shared/constants.ts"
          actions={<Sliders className="h-4 w-4 text-slate-500" />}
        >
          <dl className="space-y-2.5 text-2xs">
            <Group title="Battery">
              <Row k="SOC warning" v={`${THRESHOLDS.battery.socWarning}%`} />
              <Row k="SOC critical" v={`${THRESHOLDS.battery.socCritical}%`} />
              <Row k="Voltage range" v={`${THRESHOLDS.battery.voltageMin} – ${THRESHOLDS.battery.voltageMax} V`} />
              <Row k="Overcharge voltage" v={`${THRESHOLDS.battery.overchargeVoltage} V`} />
              <Row k="Temperature critical" v={`${THRESHOLDS.battery.temperatureCritical} °C`} />
            </Group>
            <Group title="Solar">
              <Row k="Daylight threshold" v={`${THRESHOLDS.solar.daylightLuxThreshold.toLocaleString()} lx`} />
              <Row k="Efficiency warning" v={`${THRESHOLDS.solar.efficiencyWarning * 100}%`} />
              <Row k="Temperature coefficient" v={`${THRESHOLDS.solar.temperatureCoefficient * 100}% / °C`} />
            </Group>
            <Group title="Load">
              <Row k="Overload ratio" v={`${THRESHOLDS.load.overloadRatio}× rated`} />
              <Row k="Brownout ratio" v={`${THRESHOLDS.load.brownoutRatio}× nominal`} />
            </Group>
            <Group title="Network">
              <Row k="Stale after" v={`${THRESHOLDS.network.staleMs / 1000} s`} />
              <Row k="Offline after" v={`${THRESHOLDS.network.offlineMs / 1000} s`} />
              <Row k="Packet loss warning" v={`${THRESHOLDS.network.packetLossWarningPercent}%`} />
            </Group>
          </dl>

          <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
            Thresholds are shown read-only. They are deliberately defined in source rather than
            edited at runtime, because they are safety logic and must be reviewable in version
            control.
            {!canWriteSettings && ' Your role also cannot modify system configuration.'}
          </p>
        </Panel>
      </div>

      {/* ---- account ---- */}
      <Panel title="Account">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Name" value={user?.name ?? '—'} size="sm" />
          <Metric label="Email" value={user?.email ?? '—'} size="sm" />
          <Metric label="Role" value={user?.role ?? '—'} size="sm" />
          <Metric label="Sign-in method" value={user?.provider ?? '—'} size="sm" />
        </div>

        <div className="mt-4 border-t border-panel-800 pt-3">
          <p className="metric-label">Permissions</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <span key={p} className="badge badge-neutral font-mono normal-case tracking-normal">
                {p}
              </span>
            ))}
          </div>
          <p className="mt-3 text-2xs leading-relaxed text-slate-600">
            These permissions are enforced by the server on every request. Hiding a control in the
            interface is a convenience; the authorisation check is what actually protects the
            action.
          </p>
        </div>

        {user?.mustChangePassword && (
          <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-2xs leading-relaxed text-amber-200/80">
              This account was created by the development seed script and is flagged for a password
              change. Do not use seeded credentials in a public deployment.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        min={0}
        className="input"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </dt>
      <div className="space-y-1 border-l border-panel-700 pl-3">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-600">{k}</span>
      <span className="tabular text-slate-400">{v}</span>
    </div>
  );
}
