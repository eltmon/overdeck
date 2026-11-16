import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import styles from '../styles/command-deck.module.css';

interface MarkdownModalProps {
  title: string;
  content: string;
  onClose: () => void;
}

export function MarkdownModal({ title, content, onClose }: MarkdownModalProps) {
  return (
    <Modal title={title} size="wide" onClose={onClose}>
      <div className={formStyles.content}>
        <div className={styles.markdownContent}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </Modal>
  );
}
