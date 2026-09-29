import { AppShell } from '@/components/app-shell';
import { UploadedClips } from '@/components/uploaded-clips';

export default function UploadsPage() {
  return <AppShell active="uploads"><UploadedClips/></AppShell>;
}
