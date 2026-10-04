import type { CommentLanguage, VideoComment } from '../types';
import { TABLES, readTable, uid, writeTable } from '../lib/storage';

export function commentsForVideo(videoId: string): VideoComment[] {
  return readTable<VideoComment>(TABLES.COMMENTS)
    .filter((comment) => comment.videoId === videoId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function addVideoComment(params: {
  videoId: string;
  userId: string;
  authorName: string;
  text: string;
  language: CommentLanguage;
}): VideoComment {
  const comment: VideoComment = {
    id: uid('comment'),
    videoId: params.videoId,
    userId: params.userId,
    authorName: params.authorName,
    text: params.text.trim(),
    language: params.language,
    createdAt: Date.now(),
  };
  const rows = readTable<VideoComment>(TABLES.COMMENTS);
  rows.push(comment);
  writeTable(TABLES.COMMENTS, rows.slice(-2000));
  return comment;
}
