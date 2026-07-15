import { describe, it, expect } from 'vitest';
import {
  classifyAttachmentKind,
  inferAttachmentMime,
} from '../attachmentTypes.js';

describe('classifyAttachmentKind', () => {
  it('classifies supported images by extension even without a MIME type', () => {
    expect(classifyAttachmentKind(new File([''], 'photo.png', { type: '' }))).toBe('image');
    expect(classifyAttachmentKind(new File([''], 'photo.jpg', { type: '' }))).toBe('image');
    expect(classifyAttachmentKind(new File([''], 'photo.jpeg', { type: '' }))).toBe('image');
    expect(classifyAttachmentKind(new File([''], 'photo.gif', { type: '' }))).toBe('image');
    expect(classifyAttachmentKind(new File([''], 'photo.webp', { type: '' }))).toBe('image');
  });

  it('classifies supported images by extension regardless of browser MIME', () => {
    expect(classifyAttachmentKind(new File([''], 'photo.png', { type: 'image/png' }))).toBe('image');
  });

  it('rejects unsupported image MIME types when the extension is not in the allowlist', () => {
    expect(classifyAttachmentKind(new File([''], 'scan.tiff', { type: 'image/tiff' }))).toBeNull();
    expect(classifyAttachmentKind(new File([''], 'scan.bmp', { type: 'image/bmp' }))).toBeNull();
  });

  it('rejects unsupported image extensions even when the MIME type is image/*', () => {
    expect(classifyAttachmentKind(new File([''], 'scan.tiff', { type: 'image/tiff' }))).toBeNull();
  });

  it('classifies allowed text/code/PDF files by extension', () => {
    expect(classifyAttachmentKind(new File([''], 'notes.md', { type: '' }))).toBe('file');
    expect(classifyAttachmentKind(new File([''], 'data.json', { type: 'application/json' }))).toBe('file');
    expect(classifyAttachmentKind(new File([''], 'doc.pdf', { type: 'application/pdf' }))).toBe('file');
  });

  it('rejects dotfiles and extensionless files', () => {
    expect(classifyAttachmentKind(new File([''], '.env', { type: '' }))).toBeNull();
    expect(classifyAttachmentKind(new File([''], '.env', { type: 'image/png' }))).toBeNull();
    expect(classifyAttachmentKind(new File([''], 'Makefile', { type: '' }))).toBeNull();
    expect(classifyAttachmentKind(new File([''], 'Makefile', { type: 'image/png' }))).toBeNull();
  });
});

describe('inferAttachmentMime', () => {
  it('prefers the browser-provided MIME type when present', () => {
    expect(inferAttachmentMime(new File([''], 'photo.png', { type: 'image/png' }))).toBe('image/png');
  });

  it('infers image MIME types from extension when the browser provides none', () => {
    expect(inferAttachmentMime(new File([''], 'photo.png', { type: '' }))).toBe('image/png');
    expect(inferAttachmentMime(new File([''], 'photo.jpg', { type: '' }))).toBe('image/jpeg');
    expect(inferAttachmentMime(new File([''], 'photo.jpeg', { type: '' }))).toBe('image/jpeg');
    expect(inferAttachmentMime(new File([''], 'photo.gif', { type: '' }))).toBe('image/gif');
    expect(inferAttachmentMime(new File([''], 'photo.webp', { type: '' }))).toBe('image/webp');
  });

  it('infers text/code/PDF MIME types from extension when the browser provides none', () => {
    expect(inferAttachmentMime(new File([''], 'notes.md', { type: '' }))).toBe('text/markdown');
    expect(inferAttachmentMime(new File([''], 'data.json', { type: '' }))).toBe('application/json');
    expect(inferAttachmentMime(new File([''], 'doc.pdf', { type: '' }))).toBe('application/pdf');
  });

  it('falls back to text/plain for unknown extensions', () => {
    expect(inferAttachmentMime(new File([''], 'unknown.xyz', { type: '' }))).toBe('text/plain');
  });
});
