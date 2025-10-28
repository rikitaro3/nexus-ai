import AppClient from '@/components/AppClient';
import { logger } from '@/lib/logger';

export default function HomePage() {
  logger.info('HomePageをレンダリングします。');

  return <AppClient />;
}
