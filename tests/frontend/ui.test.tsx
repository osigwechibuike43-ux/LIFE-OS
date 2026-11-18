import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, ConfirmDialog, Input, Modal, Switch } from '@/components/ui';

describe('Button', () => {
  it('is disabled and does not fire while loading', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: /save/i });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Input', () => {
  it('links label and surfaces the error accessibly', () => {
    render(<Input label="Email" error="Enter a valid email address" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
  });
});

describe('Switch', () => {
  it('toggles via click and reports state', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Memory" />);
    await userEvent.click(screen.getByRole('switch', { name: /memory/i }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Modal', () => {
  it('renders as a dialog and closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="New task"><p>body</p></Modal>);
    expect(screen.getByRole('dialog', { name: /new task/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden"><p>x</p></Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  it('requires explicit confirmation', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete note" message="Sure?" onConfirm={onConfirm} onClose={() => {}} />);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
