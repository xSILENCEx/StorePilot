"use client";
import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import type { StoreApp } from "../lib/model";
export function AppSettingsDialog({
  app,
  editable,
  onClose,
  onSave,
}: {
  app?: StoreApp;
  editable: boolean;
  onClose: () => void;
  onSave: (name: string, apple: string, google: string) => void;
}) {
  const [name, setName] = useState(app?.name ?? "");
  const [apple, setApple] = useState(app?.apple ?? "");
  const [google, setGoogle] = useState(app?.google ?? "");
  return (
    <Modal
      opened
      onClose={onClose}
      title={app ? "应用设置" : "添加应用"}
      size="md"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name.trim(), apple.trim(), google.trim());
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            填写名称与至少一个平台的应用标识。
          </Text>
          <TextInput
            data-autofocus
            required
            label="应用名称"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="例如：我的应用"
          />
          <TextInput
            label="Apple Bundle ID"
            value={apple}
            onChange={(e) => setApple(e.currentTarget.value)}
            placeholder="com.example.app"
          />
          <TextInput
            label="Google 包名"
            value={google}
            onChange={(e) => setGoogle(e.currentTarget.value)}
            placeholder="com.example.app"
          />
          <Group justify="end" className="modal-footer">
            <Button variant="default" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                !editable || !name.trim() || (!apple.trim() && !google.trim())
              }
            >
              {app ? "保存设置" : "创建应用"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
