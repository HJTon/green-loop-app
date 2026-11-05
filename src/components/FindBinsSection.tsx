import { useRef, useState } from 'react';
import { MapPinned, ChevronDown, Camera, Video, X, Loader2, Pencil, Check } from 'lucide-react';
import { Button } from '@/components/Button';
import { apiFetch } from '@/utils/apiClient';

interface FindBinsSectionProps {
  businessName: string;
  instructions?: string;
  media?: string[];
  onSave: (data: { instructions: string; media: string[] }) => Promise<void> | void;
}

const MAX_MEDIA = 4;

/**
 * Collapsible "How to find the bins" helper shown on the pickup screen. Displays
 * driver-recorded photos / short videos and written directions, and lets the
 * driver update both in the field. Videos play back sped-up (2×) so a quick
 * walkthrough stays quick.
 */
export function FindBinsSection({ businessName, instructions = '', media = [], onSave }: FindBinsSectionProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftInstructions, setDraftInstructions] = useState(instructions);
  const [draftMedia, setDraftMedia] = useState<string[]>(media);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const hasContent = (media.length > 0) || instructions.trim().length > 0;

  const startEditing = () => {
    setDraftInstructions(instructions);
    setDraftMedia(media);
    setError(null);
    setEditing(true);
    setOpen(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ instructions: draftInstructions.trim(), media: draftMedia });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'photo' | 'video') => {
    const file = e.target.files?.[0];
    if (e.target.value) e.target.value = '';
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const safeName = businessName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
      const timestamp = Date.now().toString(36);

      let base64: string;
      let mimeType: string;
      let ext: string;

      if (kind === 'photo') {
        base64 = await resizeImage(file, 1600, 0.8);
        mimeType = 'image/jpeg';
        ext = 'jpg';
      } else {
        base64 = await fileToDataUrl(file);
        mimeType = file.type || 'video/mp4';
        ext = mimeToExt(mimeType);
      }

      const filename = `find_${safeName}_${timestamp}.${ext}`;
      const res = await apiFetch('/.netlify/functions/media-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaData: base64, mimeType, filename }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }
      const { url } = await res.json();
      setDraftMedia(prev => [...prev, url]);
    } catch (err) {
      console.error('Find-bins media upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeDraftMedia = (index: number) => {
    setDraftMedia(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <MapPinned size={16} className="text-green-primary" />
          How to find the bins
          {hasContent && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-dark px-1.5 py-0.5 rounded-full">
              {media.length > 0 ? `${media.length} photo/video` : 'directions'}
            </span>
          )}
        </span>
        <ChevronDown size={18} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="p-3 space-y-3">
          {!editing ? (
            <>
              {media.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {media.map((url, i) =>
                    isVideoUrl(url) ? (
                      <video
                        key={i}
                        src={url}
                        muted
                        playsInline
                        loop
                        controls
                        onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).playbackRate = 2; }}
                        className="w-full rounded-lg border border-gray-200 bg-black"
                      />
                    ) : (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={`Find bins ${i + 1}`} className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                      </a>
                    )
                  )}
                </div>
              )}

              {instructions.trim() ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{instructions}</p>
              ) : (
                media.length === 0 && (
                  <p className="text-sm text-gray-400 italic">No photo or directions yet.</p>
                )
              )}

              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 text-sm text-green-primary hover:text-green-dark font-medium"
              >
                <Pencil size={14} />
                {hasContent ? 'Update' : 'Add a photo, video or directions'}
              </button>
            </>
          ) : (
            <>
              <textarea
                value={draftInstructions}
                onChange={e => setDraftInstructions(e.target.value)}
                rows={3}
                placeholder="e.g. Bins are down the side alley on the left, behind the blue gate."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary focus:border-transparent resize-none"
              />

              {draftMedia.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {draftMedia.map((url, i) => (
                    <div key={i} className="relative">
                      {isVideoUrl(url) ? (
                        <video src={url} muted playsInline className="w-full h-28 object-cover rounded-lg border border-gray-200 bg-black" />
                      ) : (
                        <img src={url} alt={`Find bins ${i + 1}`} className="w-full h-28 object-cover rounded-lg border border-gray-200" />
                      )}
                      <button
                        onClick={() => removeDraftMedia(i)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                        aria-label={`Remove media ${i + 1}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {draftMedia.length < MAX_MEDIA && (
                <div className="flex gap-2">
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploading}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-green-primary border border-green-primary rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    Photo
                  </button>
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    disabled={uploading}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-green-primary border border-green-primary rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
                    Video
                  </button>
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex gap-2">
                <Button variant="outline" onClick={cancelEditing} disabled={saving} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving || uploading} className="flex-1">
                  {saving ? 'Saving…' : (<><Check size={16} className="mr-1" />Save</>)}
                </Button>
              </div>
            </>
          )}

          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={e => handleFile(e, 'photo')} className="hidden" />
          <input ref={videoInputRef} type="file" accept="video/*" capture="environment" onChange={e => handleFile(e, 'video')} className="hidden" />
        </div>
      )}
    </div>
  );
}

// --- helpers ---

function isVideoUrl(url: string): boolean {
  let key = url;
  try {
    const q = url.split('?')[1];
    if (q) key = decodeURIComponent(new URLSearchParams(q).get('key') || url);
  } catch {
    // fall through to raw url test
  }
  return /\.(mp4|webm|mov|m4v|ogg)$/i.test(key) || /\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(url);
}

function mimeToExt(mime: string): string {
  if (/webm/i.test(mime)) return 'webm';
  if (/quicktime|mov/i.test(mime)) return 'mov';
  if (/ogg/i.test(mime)) return 'ogg';
  return 'mp4';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function resizeImage(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}
