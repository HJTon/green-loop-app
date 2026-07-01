import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Smartphone, Download, Share, Plus, CheckCircle2, Info, RefreshCw, Gift, Trash2, RotateCcw } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useApp } from '@/contexts/AppContext';
import {
  getWelcomeKitItems,
  saveWelcomeKitItems,
  DEFAULT_WELCOME_KIT_ITEMS,
} from '@/utils/storage';

// Type for the beforeinstallprompt event (not in lib.dom.d.ts)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function getDeferredPrompt(): BeforeInstallPromptEvent | undefined {
  return (window as unknown as { deferredInstallPrompt?: BeforeInstallPromptEvent }).deferredInstallPrompt;
}

function isStandalone(): boolean {
  // iOS
  if ((window.navigator as unknown as { standalone?: boolean }).standalone) return true;
  // Everyone else
  return window.matchMedia('(display-mode: standalone)').matches;
}

function detectPlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'other';
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { collector } = useApp();

  const [installAvailable, setInstallAvailable] = useState<boolean>(!!getDeferredPrompt());
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const platform = detectPlatform();

  // Welcome kit contents (handed to a business on their first collection)
  const [kitItems, setKitItems] = useState<string[]>(() => getWelcomeKitItems());
  const [kitSaved, setKitSaved] = useState(false);

  const updateKitItem = (index: number, value: string) => {
    setKitItems(prev => prev.map((item, i) => (i === index ? value : item)));
    setKitSaved(false);
  };

  const addKitItem = () => {
    setKitItems(prev => [...prev, '']);
    setKitSaved(false);
  };

  const removeKitItem = (index: number) => {
    setKitItems(prev => prev.filter((_, i) => i !== index));
    setKitSaved(false);
  };

  const handleSaveKit = () => {
    const cleaned = kitItems.map(i => i.trim()).filter(Boolean);
    const toSave = cleaned.length ? cleaned : [...DEFAULT_WELCOME_KIT_ITEMS];
    saveWelcomeKitItems(toSave);
    setKitItems(toSave);
    setKitSaved(true);
  };

  const handleRestoreKitDefaults = () => {
    setKitItems([...DEFAULT_WELCOME_KIT_ITEMS]);
    setKitSaved(false);
  };

  useEffect(() => {
    if (!collector) navigate('/');
  }, [collector, navigate]);

  // Listen for the install prompt becoming available/consumed mid-session
  useEffect(() => {
    const onAvailable = () => setInstallAvailable(true);
    const onConsumed = () => {
      setInstallAvailable(false);
      setInstalled(true);
    };
    window.addEventListener('installprompt-available', onAvailable);
    window.addEventListener('installprompt-consumed', onConsumed);
    return () => {
      window.removeEventListener('installprompt-available', onAvailable);
      window.removeEventListener('installprompt-consumed', onConsumed);
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setUpdateChecking(true);
    setUpdateStatus(null);
    try {
      if (!('serviceWorker' in navigator)) {
        setUpdateStatus('Service workers not supported on this browser');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setUpdateStatus('No service worker registered yet — try reloading the app');
        return;
      }
      await reg.update();
      // Give the browser a moment to detect a waiting/installing worker.
      await new Promise(r => setTimeout(r, 800));
      if (reg.waiting || reg.installing) {
        // sw.js calls skipWaiting() + clients.claim(), so the new worker
        // takes over as soon as it activates. A reload picks up the new bundle.
        setUpdateStatus('New version found — reloading…');
        setTimeout(() => window.location.reload(), 600);
      } else {
        setUpdateStatus('You are on the latest version');
      }
    } catch (err) {
      setUpdateStatus(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleInstall = async () => {
    const prompt = getDeferredPrompt();
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
      }
    } catch (err) {
      console.warn('Install prompt failed:', err);
    } finally {
      (window as unknown as { deferredInstallPrompt?: BeforeInstallPromptEvent }).deferredInstallPrompt = undefined;
      setInstallAvailable(false);
    }
  };

  if (!collector) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Settings" showBack />

      <div className="px-4 py-4 space-y-4">
        {/* Add to Home Screen section */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Smartphone size={18} className="text-green-primary" />
            <h2 className="font-semibold text-gray-900">Install on your phone</h2>
          </div>

          <div className="p-4 space-y-3">
            {installed ? (
              <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg p-3">
                <CheckCircle2 size={18} />
                <span className="text-sm font-medium">App is already installed on this device.</span>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Add Green Loop to your home screen so you can open it like a normal app, with its own icon and no browser bar.
                </p>

                {/* Android / Chrome / Edge: native install button */}
                {installAvailable && (
                  <Button onClick={handleInstall} className="w-full">
                    <Download size={18} className="mr-2" />
                    Add to Home Screen
                  </Button>
                )}

                {/* iOS instructions */}
                {platform === 'ios' && !installAvailable && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-semibold text-blue-900">On iPhone / iPad:</p>
                    <ol className="text-sm text-blue-900 space-y-1 list-decimal pl-5">
                      <li>Open this page in <strong>Safari</strong> (not Chrome).</li>
                      <li>
                        Tap the <Share size={14} className="inline mb-0.5" /> <strong>Share</strong> button at the bottom.
                      </li>
                      <li>
                        Scroll down and tap <Plus size={14} className="inline mb-0.5" /> <strong>Add to Home Screen</strong>.
                      </li>
                      <li>Tap <strong>Add</strong> in the top-right.</li>
                    </ol>
                  </div>
                )}

                {/* Android Chrome fallback instructions if no prompt fired */}
                {platform === 'android' && !installAvailable && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-semibold text-blue-900">On Android:</p>
                    <ol className="text-sm text-blue-900 space-y-1 list-decimal pl-5">
                      <li>Open this page in <strong>Chrome</strong>.</li>
                      <li>Tap the <strong>⋮</strong> menu in the top-right.</li>
                      <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                    </ol>
                    <p className="text-xs text-blue-800 italic pt-1">
                      Tip: if you just logged in, come back to this page in a few seconds — Chrome sometimes needs a moment before offering the install button above.
                    </p>
                  </div>
                )}

                {/* Desktop fallback */}
                {platform === 'other' && !installAvailable && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 flex gap-2">
                    <Info size={16} className="shrink-0 mt-0.5 text-gray-500" />
                    <span>
                      On desktop Chrome or Edge, look for the install icon in the address bar. This feature works best on a phone.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* App updates */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <RefreshCw size={18} className="text-green-primary" />
            <h2 className="font-semibold text-gray-900">App updates</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-600">
              The app updates itself in the background, but you can force a check now to grab the latest version straight away.
            </p>
            <Button onClick={handleCheckForUpdates} disabled={updateChecking} className="w-full">
              <RefreshCw size={18} className={`mr-2 ${updateChecking ? 'animate-spin' : ''}`} />
              {updateChecking ? 'Checking…' : 'Check for updates'}
            </Button>
            {updateStatus && (
              <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
                {updateStatus}
              </div>
            )}
          </div>
        </section>

        {/* Welcome kit section */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Gift size={18} className="text-green-primary" />
            <h2 className="font-semibold text-gray-900">First-visit welcome kit</h2>
          </div>

          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-600">
              What to hand over to a business on their first collection. Drivers see this
              checklist on the pickup screen and a reminder on the load-the-van screen.
            </p>

            <div className="space-y-2">
              {kitItems.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item}
                    onChange={e => updateKitItem(index, e.target.value)}
                    placeholder="e.g. 2 posters"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => removeKitItem(index)}
                    className="w-10 h-10 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors shrink-0"
                    aria-label="Remove item"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addKitItem}
              className="w-full py-2 text-sm text-green-primary border border-green-primary rounded-lg hover:bg-green-50 transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={16} /> Add item
            </button>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSaveKit} className="flex-1">
                {kitSaved ? (
                  <>
                    <CheckCircle2 size={18} className="mr-2" /> Saved
                  </>
                ) : (
                  'Save kit'
                )}
              </Button>
              <Button variant="outline" onClick={handleRestoreKitDefaults}>
                <RotateCcw size={16} className="mr-1" /> Defaults
              </Button>
            </div>
          </div>
        </section>

        {/* About section */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">About</h2>
          </div>
          <div className="p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Logged in as</span>
              <span className="text-gray-900 font-medium">{collector.name}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>App</span>
              <span className="text-gray-900 font-medium">Green Loop Collector</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
