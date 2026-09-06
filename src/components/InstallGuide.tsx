'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Download, Monitor, Share, Smartphone } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'ios' | 'android' | 'desktop';

/**
 * Login-page "Add to home screen" guide. Hidden entirely once the app runs
 * standalone. Chrome (Android/desktop) exposes the native install prompt via
 * `beforeinstallprompt`; iOS has no API, so the steps are the whole story there.
 */
export function InstallGuide({ className }: { className?: string }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<Platform>('desktop');
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) setPlatform('ios');
    else if (/android/.test(ua)) setPlatform('android');

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isStandalone) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const sections: { key: Platform; icon: ReactNode; title: string; steps: ReactNode[] }[] = [
    {
      key: 'ios',
      icon: <Smartphone className="h-4 w-4 text-primary" />,
      title: t('install.ios.title'),
      steps: [
        <>
          {t('install.ios.step1')} <Share className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        </>,
        t('install.ios.step2'),
        t('install.ios.step3'),
      ],
    },
    {
      key: 'android',
      icon: <Smartphone className="h-4 w-4 text-primary" />,
      title: t('install.android.title'),
      steps: [t('install.android.step1'), t('install.android.step2'), t('install.android.step3')],
    },
    {
      key: 'desktop',
      icon: <Monitor className="h-4 w-4 text-primary" />,
      title: t('install.desktop.title'),
      steps: [t('install.desktop.step1'), t('install.desktop.step2')],
    },
  ];
  // Detected platform first.
  sections.sort((a, b) => Number(b.key === platform) - Number(a.key === platform));

  return (
    <section className={cn('surface w-full max-w-sm p-5', className)}>
      <div className="flex items-start gap-4">
        <AppIcon size={48} />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{t('install.eyebrow')}</div>
          <h2 className="mt-1 text-[15px] font-semibold leading-snug">{t('install.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('install.subtitle')}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {(deferredPrompt || installed) && (
          <Button onClick={handleInstall} disabled={installed} className="w-full">
            <Download className="mr-2 h-4 w-4" />
            {installed ? t('install.installed') : t('install.button')}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="install-steps"
          className="w-full"
        >
          {expanded ? t('install.hideSteps') : t('install.showSteps')}
          <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </Button>
      </div>

      {expanded && (
        <div id="install-steps" className="mt-4 flex flex-col gap-3">
          {sections.map((s) => {
            const current = s.key === platform;
            return (
              <div
                key={s.key}
                className={cn(
                  'rounded-md border p-4',
                  current ? 'border-primary/30 bg-primary/10' : 'border-border bg-muted/30'
                )}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {s.icon}
                  <span>{s.title}</span>
                  {current && (
                    <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {t('install.thisDevice')}
                    </span>
                  )}
                </div>
                <ol className="mt-2 list-inside list-decimal space-y-1.5 text-sm text-muted-foreground">
                  {s.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
