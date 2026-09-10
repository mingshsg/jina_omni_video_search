'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  EuiButtonGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHeader,
  EuiHeaderLink,
  EuiHeaderLinks,
  EuiHeaderSection,
  EuiHeaderSectionItem,
  EuiIcon,
  EuiPageTemplate,
  EuiTitle,
} from '@elastic/eui';
import { useLocale } from '@/lib/i18n/locale-context';
import type { Locale } from '@/lib/i18n/en';

type AppShellProps = {
  children: React.ReactNode;
  pageTitle?: string;
  pageDescription?: string;
  restrictWidth?: number | boolean | string;
  rightSideItems?: React.ReactNode[];
};

export function AppShell({
  children,
  pageTitle,
  pageDescription,
  restrictWidth = '1200px',
  rightSideItems,
}: AppShellProps) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLocale();

  const localeOptions = [
    { id: 'zh', label: t.localeZh },
    { id: 'en', label: t.localeEn },
  ];

  return (
    <>
      <EuiHeader position="fixed">
        <EuiHeaderSection grow={false}>
          <EuiHeaderSectionItem>
            <Link
              href="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 12px',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <EuiIcon type="play" size="m" />
              <EuiTitle size="xxs">
                <span>{t.appTitle}</span>
              </EuiTitle>
            </Link>
          </EuiHeaderSectionItem>
        </EuiHeaderSection>

        <EuiHeaderSection side="right">
          <EuiHeaderSectionItem>
            <EuiHeaderLinks>
              <Link href="/" passHref legacyBehavior>
                <EuiHeaderLink isActive={pathname === '/'}>
                  {t.navSearch}
                </EuiHeaderLink>
              </Link>
              <Link href="/search-image" passHref legacyBehavior>
                <EuiHeaderLink isActive={pathname === '/search-image'}>
                  {t.navImageSearch}
                </EuiHeaderLink>
              </Link>
              <Link href="/ingest" passHref legacyBehavior>
                <EuiHeaderLink isActive={pathname === '/ingest'}>
                  {t.navImport}
                </EuiHeaderLink>
              </Link>
              <Link href="/library" passHref legacyBehavior>
                <EuiHeaderLink isActive={pathname === '/library'}>
                  {t.navLibrary}
                </EuiHeaderLink>
              </Link>
            </EuiHeaderLinks>
          </EuiHeaderSectionItem>
          <EuiHeaderSectionItem>
            <EuiFlexGroup
              alignItems="center"
              gutterSize="s"
              responsive={false}
              style={{ paddingRight: 8 }}
            >
              <EuiFlexItem grow={false}>
                <EuiButtonGroup
                  legend="Language"
                  options={localeOptions}
                  idSelected={locale}
                  onChange={(id) => setLocale(id as Locale)}
                  buttonSize="compressed"
                  color="text"
                />
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiHeaderSectionItem>
        </EuiHeaderSection>
      </EuiHeader>

      <EuiPageTemplate
        restrictWidth={restrictWidth}
        style={{ paddingTop: 48 }}
        bottomBorder={false}
      >
        {(pageTitle || rightSideItems) && (
          <EuiPageTemplate.Header
            pageTitle={pageTitle}
            description={pageDescription}
            rightSideItems={rightSideItems}
          />
        )}
        <EuiPageTemplate.Section>{children}</EuiPageTemplate.Section>
      </EuiPageTemplate>
    </>
  );
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
