import { PreviewView } from '@/components/pages';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Short alias of /key. STRICTLY NON-MUTATING preview.
export default function KShortPage({
  params,
}: {
  params: { wid: string; seq: string; symbol: string };
}) {
  return <PreviewView params={params} />;
}
