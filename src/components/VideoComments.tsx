import React, { useEffect, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import type { CommentLanguage, VideoComment } from '../types';
import { addVideoComment, commentsForVideo } from '../services/commentService';
import { Button, Card, SectionTitle } from './ui';

const LANGUAGES: CommentLanguage[] = [
  'English', 'Hindi', 'Marathi', 'Bengali', 'Gujarati',
  'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'Other',
];

function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function VideoComments({
  videoId,
  user,
}: {
  videoId: string;
  user: { id: string; name: string } | null;
}) {
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<CommentLanguage>('English');
  const [error, setError] = useState('');

  const refresh = () => setComments(commentsForVideo(videoId));

  useEffect(() => {
    refresh();
  }, [videoId]);

  const submit = () => {
    const value = text.trim();
    if (!user) {
      setError('Sign in to comment.');
      return;
    }
    if (!value) {
      setError('Write a comment first.');
      return;
    }
    addVideoComment({
      videoId,
      userId: user.id,
      authorName: user.name,
      text: value,
      language,
    });
    setText('');
    setError('');
    refresh();
  };

  return (
    <Card className="mt-5 !p-4 sm:!p-5">
      <SectionTitle
        title={`Comments (${comments.length})`}
        subtitle="Comment naturally in English, Hindi, Marathi, or any supported Unicode language."
        icon={<MessageCircle size={18} />}
      />

      <div className="mt-4">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
          }}
          maxLength={1000}
          rows={3}
          placeholder="Write a comment… / टिप्पणी लिखें… / प्रतिक्रिया लिहा…"
          className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-rose-950"
          aria-label="Write a comment"
        />
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor="comment-language" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Language
            </label>
            <select
              id="comment-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as CommentLanguage)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            >
              {LANGUAGES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <span className="text-[10px] text-slate-400">{text.length}/1000</span>
          </div>
          <Button size="sm" icon={<Send size={14} />} onClick={submit}>
            Comment
          </Button>
        </div>
        {error && <p className="mt-2 text-xs font-semibold text-rose-500">{error}</p>}
      </div>

      <div className="mt-5 space-y-3">
        {comments.length === 0 ? (
          <div className="rounded-xl bg-slate-50 px-4 py-7 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            Be the first to comment.
          </div>
        ) : (
          comments.map((comment) => (
            <article key={comment.id} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-100 text-xs font-extrabold text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
                  {comment.authorName.trim().charAt(0).toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-bold">{comment.authorName}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {comment.language}
                    </span>
                    <span className="text-[10px] text-slate-400">{timeAgo(comment.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {comment.text}
                  </p>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}
