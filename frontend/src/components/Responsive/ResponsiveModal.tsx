import { Modal, type ModalProps } from 'antd';

export function ResponsiveModal({ className = '', ...props }: ModalProps) {
  return <Modal {...props} className={`responsive-modal ${className}`} />;
}
