import { ExecuteView } from '@/components/pages';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Short alias of /execute. The only mutating route.
export default function XShortPage({
  params,
}: {
  params: { wid: string; seq: string; symbol: string; token: string };
}) {
  return <ExecuteView params={params} />;
}
