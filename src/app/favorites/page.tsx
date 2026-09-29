import { AppShell } from '@/components/app-shell';
import { FavoriteClips } from '@/components/favorite-clips';

export default function FavoritesPage() {
  return <AppShell active="favorites"><FavoriteClips/></AppShell>;
}
