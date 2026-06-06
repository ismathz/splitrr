import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BILL_CURRENCY_OPTIONS, normalizeCurrencyCode } from "@splitbot/shared";
import useEmblaCarousel from "embla-carousel-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import AutoAnimateContainer from "@/components/AutoAnimateContainer";
import { FormErrorAlert } from "@/components/FormErrorAlert";
import { Toggle } from "@/components/ui/toggle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { toUserFriendlyErrorMessage } from "@/lib/userFriendlyError";

import { type Item } from "../billMock";
import {
  AUTO_FILL_MAX_GROUP_SIZE,
  parseStartParamHasCid,
  type TelegramGroupMember,
  useTelegramGroupMembers,
} from "@/lib/telegramGroupMembers";
import {
  isGroupLikeLaunch,
  useTelegramLaunchContext,
} from "@/lib/telegramLaunchContext";
import {
  createBillSession,
  getSplitbotApiBase,
  resolveBillContextForApi,
  runReceiptOcr,
  updateBillDetails,
  uploadReceipt,
} from "@/lib/splitbotApi";
import { getItemDisplayEmoji } from "@/lib/itemEmoji";
import {
  ArrowDown01Icon,
  ArrowLeftIcon,
  DeleteIcon,
  DragDropVerticalIcon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return initials || name.slice(0, 2).toUpperCase();
}

function getAvatarColors(name: string) {
  const seed = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = seed % 360;
  const lightness = 38 + (seed % 18);
  const backgroundColor = `hsl(${hue} 80% ${lightness}%)`;
  const foregroundColor = lightness > 50 ? "#111827" : "#ffffff";
  return { backgroundColor, foregroundColor };
}

function rgb24IntToCss(n: number) {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b, css: `rgb(${r} ${g} ${b})` };
}

function pickReadableForegroundFromRgb(r: number, g: number, b: number) {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#111827" : "#ffffff";
}

function isNameInGroup(name: string, groupMembers: string[]): boolean {
  const n = name.trim().toLowerCase();
  return groupMembers.some((g) => g.toLowerCase() === n);
}

/** Prefer the group's spelling when the typed name matches case-insensitively. */
function canonicalMemberName(raw: string, groupMembers: string[]): string {
  const t = raw.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  const match = groupMembers.find((g) => g.toLowerCase() === lower);
  return match ?? t;
}

function MemberAvatar({
  name,
  avatarBgColors,
  photoUrl,
}: {
  name: string;
  avatarBgColors?: number[];
  photoUrl?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (photoUrl && !imgFailed) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="h-6 w-6 shrink-0 rounded-full object-cover"
        onError={() => setImgFailed(true)}
      />
    );
  }

  const initials = getInitials(name);
  const bg = avatarBgColors && avatarBgColors.length ? avatarBgColors : null;

  let backgroundColor: string | undefined;
  let backgroundImage: string | undefined;
  let foregroundColor: string;

  if (bg && bg.length) {
    const c0 = rgb24IntToCss(bg[0]);
    const c1 = bg.length >= 2 ? rgb24IntToCss(bg[1]) : null;
    backgroundColor = c0.css;
    foregroundColor = pickReadableForegroundFromRgb(c0.r, c0.g, c0.b);
    if (c1) {
      backgroundImage = `linear-gradient(135deg, ${c0.css}, ${c1.css})`;
    }
  } else {
    const v = getAvatarColors(name);
    backgroundColor = v.backgroundColor;
    foregroundColor = v.foregroundColor;
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{ backgroundColor, backgroundImage, color: foregroundColor }}
    >
      {initials}
    </span>
  );
}

function MembersCarousel({
  members,
  assignees,
  onToggleMember,
  getAvatarBgColors,
  getPhotoUrl,
}: {
  members: string[];
  assignees: string[];
  onToggleMember: (member: string, nextPressed: boolean) => void;
  getAvatarBgColors?: (name: string) => number[] | undefined;
  getPhotoUrl?: (name: string) => string | undefined;
}) {
  const [emblaRef] = useEmblaCarousel({
    loop: false,
    align: "start",
    dragFree: true,
  });

  return (
    <div
      ref={emblaRef}
      className="overflow-hidden cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        {members.map((member) => {
          const checked = assignees.includes(member);
          const avatarBgColors = getAvatarBgColors?.(member);
          const photoUrl = getPhotoUrl?.(member);

          return (
            <div key={member} className="flex-[0_0_auto]">
              <Toggle
                pressed={checked}
                onPressedChange={(nextPressed) =>
                  onToggleMember(member, nextPressed)
                }
                className="rounded-full text-sm p-1 pr-2.5 gap-1.5"
              >
                <MemberAvatar
                  name={member}
                  avatarBgColors={avatarBgColors}
                  photoUrl={photoUrl}
                />
                <span>{member}</span>
              </Toggle>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortableChargeRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-80" : undefined}
    >
      <div className="flex items-start gap-3 py-3">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          <HugeiconsIcon
            icon={DragDropVerticalIcon}
            strokeWidth={3}
            className="size-6"
          />
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export interface BillEditorInitialBill {
  title: string;
  billDate: string;
  place: string | null;
  currency: string;
  items: Item[];
}

export type BillEditorMode =
  /** Starting from scratch or from a receipt scan. Creates a new bill on save. */
  | {
      kind: "create";
      /** When true, an image will be uploaded + OCR'd at mount. */
      isFromReceiptScan: boolean;
      /** The image to upload/scan when `isFromReceiptScan` is true. */
      receiptFile?: File;
    }
  /** Edit an existing bill. Save PATCHes the server. */
  | {
      kind: "edit";
      billId: string;
      initial: BillEditorInitialBill;
    };

export interface BillEditorProps {
  mode: BillEditorMode;
  /** Called when the user presses the back button. */
  onBack?: () => void;
  /** Text for the back button. Defaults to "Back to home" / "Back". */
  backLabel?: string;
  /** Create mode: called after the server creates a bill (navigate to it). */
  onOpenBill?: (billId: string) => void;
  /** Edit mode: called after save succeeds. */
  onSaveComplete?: () => void;
  /** Edit mode: optional cancel handler (e.g. to close edit mode). */
  onCancel?: () => void;
}

export function BillEditor(props: BillEditorProps) {
  const SERVICE_CHARGE_ROW_ID = "builtin-service-charge";
  const TAX_ROW_ID = "builtin-tax";

  type CustomAdjustment = {
    id: string;
    name: string;
    amountType: "fixed" | "percentage";
    value: number;
  };

  const isEditMode = props.mode.kind === "edit";
  const initialBill =
    props.mode.kind === "edit" ? props.mode.initial : undefined;
  const editingBillId =
    props.mode.kind === "edit" ? props.mode.billId : null;
  const isFromReceiptScan =
    props.mode.kind === "create" && props.mode.isFromReceiptScan;
  const receiptFile =
    props.mode.kind === "create" ? props.mode.receiptFile : undefined;

  const launchCtx = useTelegramLaunchContext();
  const { members: groupMembers, isLoading: groupMembersLoading } =
    useTelegramGroupMembers();

  const groupMemberNames = useMemo(
    () => groupMembers.map((m) => m.name),
    [groupMembers],
  );

  const memberByName = useMemo(
    () => new Map(groupMembers.map((m) => [m.name, m] as const)),
    [groupMembers],
  );

  const miniappApiBase = useMemo(
    () => import.meta.env.VITE_BOT_MINIAPP_API?.replace(/\/$/, "") ?? "",
    [],
  );

  const splitbotApiBase = useMemo(() => getSplitbotApiBase(), []);

  const billApiContext = useMemo(
    () => resolveBillContextForApi(launchCtx),
    [
      launchCtx.chat?.id,
      launchCtx.chat?.title,
      launchCtx.startParam,
      launchCtx.chatType,
      launchCtx.currentUser?.id,
    ],
  );

  const resolveMemberPhotoUrl = useCallback(
    (mem: TelegramGroupMember | undefined) => {
      if (!mem) return undefined;
      if (mem.photoUrl) return mem.photoUrl;
      if (mem.avatarProxyPath && miniappApiBase) {
        return `${miniappApiBase}${mem.avatarProxyPath}`;
      }
      return undefined;
    },
    [miniappApiBase],
  );

  const allowAutofillFromGroupContext = useMemo(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.has("members")) return true;
    }
    if (import.meta.env.VITE_TELEGRAM_GROUP_MEMBERS) return true;
    if (isGroupLikeLaunch(launchCtx)) return true;
    if (parseStartParamHasCid(launchCtx.startParam)) return true;
    return false;
  }, [launchCtx]);

  const [billMembers, setBillMembers] = useState<string[]>(() => {
    if (initialBill) {
      const members = new Set<string>();
      for (const it of initialBill.items) {
        for (const a of it.assignees) members.add(a);
      }
      return Array.from(members);
    }
    return [];
  });
  const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
  const [currencyDrawerOpen, setCurrencyDrawerOpen] = useState(false);
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [manualMemberInput, setManualMemberInput] = useState("");
  const [manualMemberError, setManualMemberError] = useState<string | null>(
    null,
  );
  const didApplyAutofillRef = useRef(false);

  const [items, setItems] = useState<Item[]>(() =>
    initialBill ? initialBill.items.map((it) => ({ ...it })) : [],
  );
  const [ocrDiscountAdjustments, setOcrDiscountAdjustments] = useState<
    CustomAdjustment[]
  >([]);

  type OcrPhase =
    | "idle"
    | "loading"
    | "uploading"
    | "scanning"
    | "ok"
    | "error"
    | "skipped";
  const [ocrPhase, setOcrPhase] = useState<OcrPhase>(() =>
    isEditMode ? "skipped" : "idle",
  );
  const [ocrError, setOcrError] = useState<string | null>(null);
  const isOcrProcessing =
    ocrPhase === "loading" || ocrPhase === "uploading" || ocrPhase === "scanning";
  const showOnlyOcrStatus =
    isFromReceiptScan && (isOcrProcessing || ocrPhase === "error");
  /** Server bill session id when created via API (receipt scan or "Open bill"). */
  const [serverBillId, setServerBillId] = useState<string | null>(
    editingBillId,
  );
  const [isSavingBill, setIsSavingBill] = useState(false);
  const [saveBillError, setSaveBillError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode) {
      setOcrPhase("skipped");
      return;
    }
    if (!isFromReceiptScan || !receiptFile) {
      setOcrPhase("skipped");
      return;
    }
    if (!splitbotApiBase) {
      setOcrPhase("error");
      setOcrError(
        "Configure VITE_SPLITBOT_API (Splitbot API URL) to scan receipts from the web app.",
      );
      return;
    }
    if (!billApiContext) {
      setOcrPhase("error");
      setOcrError(
        "Could not start a bill session (missing browser context). Try again, or open the Mini App from Telegram if you use group features.",
      );
      return;
    }

    let cancelled = false;
    setOcrPhase("uploading");
    setOcrError(null);

    const day = new Date().toISOString().slice(0, 10);
    const title = `Receipt ${day}`;

    (async () => {
      try {
        const { billId } = await createBillSession(splitbotApiBase, {
          telegramChatId: billApiContext.telegramChatId,
          groupTitle: billApiContext.groupTitle,
          title,
          createdByUserId: launchCtx.currentUser?.id,
          billDate: day,
          place: null,
        });
        setServerBillId(billId);
        const { signedUrl } = await uploadReceipt(
          splitbotApiBase,
          billId,
          receiptFile,
        );
        if (cancelled) return;
        setOcrPhase("scanning");
        const parsed = await runReceiptOcr(splitbotApiBase, billId, signedUrl);
        if (cancelled) return;
        setCurrencyCode(normalizeCurrencyCode(parsed.currency));
        setItems(
          parsed.items.map((it, i) => ({
            id: `ocr-${billId}-${i}`,
            name: it.name,
            totalPriceCents: it.totalPriceCents,
            assignees: [],
          })),
        );
        setOcrDiscountAdjustments(
          (parsed.discountAdjustments ?? []).map((adjustment, i) => ({
            id: `ocr-discount-${billId}-${i}`,
            name: adjustment.name || "Discount",
            amountType: "fixed",
            value: adjustment.amountCents / 100,
          })),
        );
        setOcrPhase("ok");
      } catch (e) {
        if (!cancelled) {
          setOcrPhase("error");
          setOcrError(toUserFriendlyErrorMessage(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isEditMode,
    isFromReceiptScan,
    receiptFile,
    splitbotApiBase,
    billApiContext,
    launchCtx.currentUser?.id,
  ]);

  const [isAddingManualItem, setIsAddingManualItem] = useState(false);
  const [manualItemName, setManualItemName] = useState("");
  const [manualItemTotalPrice, setManualItemTotalPrice] = useState("");
  const [manualItemError, setManualItemError] = useState<string | null>(null);
  const DELETE_CONFIRM_SERVICE_CHARGE = "charge:service";
  const DELETE_CONFIRM_TAX = "charge:tax";
  const deleteConfirmKeyForItem = (id: string) => `item:${id}`;
  const deleteConfirmKeyForAdjustment = (id: string) => `adjustment:${id}`;

  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"name" | "price" | null>(
    null,
  );
  const [draftItemName, setDraftItemName] = useState("");
  const [draftItemTotalPrice, setDraftItemTotalPrice] = useState("");

  const [currencyCode, setCurrencyCode] = useState(
    () => initialBill?.currency ?? "MVR",
  );
  const currencyLabel = currencyCode;
  const [serviceChargeRatePct, setServiceChargeRatePct] = useState(10);
  const [taxRatePct, setTaxRatePct] = useState(8);
  const [serviceChargeRateInput, setServiceChargeRateInput] = useState("10");
  const [taxRateInput, setTaxRateInput] = useState("8");
  const [editingRateField, setEditingRateField] = useState<
    "serviceCharge" | "tax" | null
  >(null);
  const [isServiceChargeEnabled, setIsServiceChargeEnabled] = useState(
    () => !isEditMode,
  );
  const [isTaxEnabled, setIsTaxEnabled] = useState(() => !isEditMode);
  const [customAdjustments, setCustomAdjustments] = useState<
    CustomAdjustment[]
  >([]);
  const [chargeRowOrder, setChargeRowOrder] = useState<string[]>([
    SERVICE_CHARGE_ROW_ID,
    TAX_ROW_ID,
  ]);
  const [isAddingAdjustment, setIsAddingAdjustment] = useState(false);
  const [adjustmentNameInput, setAdjustmentNameInput] = useState("");
  const [adjustmentAmountType, setAdjustmentAmountType] = useState<
    "fixed" | "percentage"
  >("fixed");
  const [adjustmentValueInput, setAdjustmentValueInput] = useState("");
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

  // Extra editable fields (edit mode uses these; create mode keeps defaults).
  const [billTitle, setBillTitle] = useState(
    () => initialBill?.title ?? "",
  );
  const [billDate, setBillDate] = useState(
    () =>
      initialBill?.billDate ?? new Date().toISOString().slice(0, 10),
  );
  const [billPlace, setBillPlace] = useState(
    () => initialBill?.place ?? "",
  );

  useEffect(() => {
    setCustomAdjustments(ocrDiscountAdjustments);
  }, [ocrDiscountAdjustments]);

  const resetManualItemForm = () => {
    setManualItemName("");
    setManualItemTotalPrice("");
    setManualItemError(null);
  };

  const submitManualItem = () => {
    const name = manualItemName.trim();
    const parsed = Number(manualItemTotalPrice);

    if (!name) {
      setManualItemError("Item name is required.");
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 0) {
      setManualItemError("Enter a valid total price (e.g. 12.50).");
      return;
    }

    const totalPriceCents = Math.round(parsed * 100);
    if (totalPriceCents <= 0) {
      setManualItemError("Total price must be greater than 0.");
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        totalPriceCents,
        assignees: [],
      },
    ]);

    setIsAddingManualItem(false);
    resetManualItemForm();
  };
  const resetAdjustmentForm = () => {
    setAdjustmentNameInput("");
    setAdjustmentAmountType("fixed");
    setAdjustmentValueInput("");
    setAdjustmentError(null);
  };

  const submitAdjustment = () => {
    const name = adjustmentNameInput.trim();
    const parsed = Number(adjustmentValueInput);

    if (!name) {
      setAdjustmentError("Name is required.");
      return;
    }
    if (!Number.isFinite(parsed) || parsed === 0) {
      setAdjustmentError("Value must be a valid number and cannot be 0.");
      return;
    }

    setCustomAdjustments((prev) => [
      ...prev,
      {
        id: `adjustment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        amountType: adjustmentAmountType,
        value: parsed,
      },
    ]);
    setIsAddingAdjustment(false);
    resetAdjustmentForm();
  };

  useEffect(() => {
    if (groupMembersLoading) return;
    if (didApplyAutofillRef.current) return;
    didApplyAutofillRef.current = true;
    if (isEditMode) return;
    if (!allowAutofillFromGroupContext) return;
    if (!groupMembers.length) return;
    if (groupMembers.length <= AUTO_FILL_MAX_GROUP_SIZE) {
      setBillMembers(groupMemberNames);
    }
  }, [
    groupMembers,
    groupMembersLoading,
    allowAutofillFromGroupContext,
    groupMemberNames,
    isEditMode,
  ]);

  useEffect(() => {
    const allow = new Set(billMembers);
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        assignees: item.assignees.filter((a) => allow.has(a)),
      })),
    );
  }, [billMembers]);

  const billMembersOrdered = useMemo(() => {
    const fromGroup = groupMemberNames.filter((m) => billMembers.includes(m));
    const fromManual = billMembers.filter(
      (m) => !isNameInGroup(m, groupMemberNames),
    );
    return [...fromGroup, ...fromManual];
  }, [groupMemberNames, billMembers]);

  const filteredGroupMembersForDrawer = useMemo(() => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) return groupMemberNames;
    return groupMemberNames.filter((m) => m.toLowerCase().includes(q));
  }, [groupMemberNames, memberFilter]);

  const manualOnlyBillMembers = useMemo(
    () => billMembers.filter((m) => !isNameInGroup(m, groupMemberNames)),
    [billMembers, groupMemberNames],
  );

  const filteredManualMembersForDrawer = useMemo(() => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) return manualOnlyBillMembers;
    return manualOnlyBillMembers.filter((m) => m.toLowerCase().includes(q));
  }, [manualOnlyBillMembers, memberFilter]);

  const filteredCurrencyOptions = useMemo(() => {
    const q = currencyFilter.trim().toLowerCase();
    if (!q) return BILL_CURRENCY_OPTIONS;
    return BILL_CURRENCY_OPTIONS.filter(
      (o) =>
        o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [currencyFilter]);

  const addManualMember = () => {
    const canonical = canonicalMemberName(manualMemberInput, groupMemberNames);
    if (!canonical) {
      setManualMemberError("Enter a name.");
      return;
    }
    const already = billMembers.some(
      (m) => m.toLowerCase() === canonical.toLowerCase(),
    );
    if (already) {
      setManualMemberError("That person is already in this bill.");
      return;
    }
    setManualMemberError(null);
    setBillMembers((prev) => [...prev, canonical]);
    setManualMemberInput("");
  };

  const openMembersDrawer = () => {
    setMemberFilter("");
    setManualMemberInput("");
    setManualMemberError(null);
    setMembersDrawerOpen(true);
  };

  const commitPercentageInput = (
    draftValue: string,
    fallback: number,
    setDraftValue: React.Dispatch<React.SetStateAction<string>>,
    setRate: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraftValue(String(fallback));
      return;
    }
    const normalized = Math.round(parsed * 100) / 100;
    setRate(normalized);
    setDraftValue(String(normalized));
  };
  const beginRateEdit = (field: "serviceCharge" | "tax") => {
    if (field === "serviceCharge") {
      setServiceChargeRateInput(String(serviceChargeRatePct));
    } else {
      setTaxRateInput(String(taxRatePct));
    }
    setEditingRateField(field);
  };

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const share = Math.floor(
        item.totalPriceCents / Math.max(item.assignees.length, 1),
      );
      for (const member of item.assignees) {
        map.set(member, (map.get(member) ?? 0) + share);
      }
    }

    return billMembersOrdered
      .filter((member) => map.has(member))
      .map((member) => [member, map.get(member)!] as [string, number]);
  }, [items, billMembersOrdered]);

  const formatCents = (cents: number) => (cents / 100).toFixed(2);

  const subtotalCents = useMemo(
    () => items.reduce((sum, item) => sum + item.totalPriceCents, 0),
    [items],
  );
  const { serviceChargeCents, serviceChargeBaseCents, taxCents, taxBaseCents } =
    useMemo(() => {
      let runningBaseCents = subtotalCents;
      let nextServiceChargeCents = 0;
      let nextTaxCents = 0;
      let nextServiceChargeBaseCents = subtotalCents;
      let nextTaxBaseCents = subtotalCents;

      const orderedBuiltinRows = chargeRowOrder.filter(
        (rowId) => rowId === SERVICE_CHARGE_ROW_ID || rowId === TAX_ROW_ID,
      );

      if (!orderedBuiltinRows.includes(SERVICE_CHARGE_ROW_ID)) {
        orderedBuiltinRows.push(SERVICE_CHARGE_ROW_ID);
      }
      if (!orderedBuiltinRows.includes(TAX_ROW_ID)) {
        orderedBuiltinRows.push(TAX_ROW_ID);
      }

      for (const rowId of orderedBuiltinRows) {
        if (rowId === SERVICE_CHARGE_ROW_ID && isServiceChargeEnabled) {
          nextServiceChargeBaseCents = runningBaseCents;
          nextServiceChargeCents = Math.round(
            (runningBaseCents * serviceChargeRatePct) / 100,
          );
          runningBaseCents += nextServiceChargeCents;
        }

        if (rowId === TAX_ROW_ID && isTaxEnabled) {
          nextTaxBaseCents = runningBaseCents;
          nextTaxCents = Math.round((runningBaseCents * taxRatePct) / 100);
          runningBaseCents += nextTaxCents;
        }
      }

      return {
        serviceChargeCents: nextServiceChargeCents,
        serviceChargeBaseCents: nextServiceChargeBaseCents,
        taxCents: nextTaxCents,
        taxBaseCents: nextTaxBaseCents,
      };
    }, [
      subtotalCents,
      chargeRowOrder,
      isServiceChargeEnabled,
      isTaxEnabled,
      serviceChargeRatePct,
      taxRatePct,
      SERVICE_CHARGE_ROW_ID,
      TAX_ROW_ID,
    ]);
  const customAdjustmentRows = useMemo(
    () =>
      customAdjustments.map((adjustment) => {
        const cents =
          adjustment.amountType === "fixed"
            ? Math.round(adjustment.value * 100)
            : Math.round((subtotalCents * adjustment.value) / 100);
        return { ...adjustment, cents };
      }),
    [customAdjustments, subtotalCents],
  );
  const customAdjustmentsTotalCents = useMemo(
    () => customAdjustmentRows.reduce((sum, row) => sum + row.cents, 0),
    [customAdjustmentRows],
  );
  const grandTotalCents =
    subtotalCents + serviceChargeCents + taxCents + customAdjustmentsTotalCents;
  const customAdjustmentMap = useMemo(
    () =>
      new Map(
        customAdjustmentRows.map((adjustment) => [adjustment.id, adjustment]),
      ),
    [customAdjustmentRows],
  );
  const dndSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
  );
  const splitTotals = useMemo(() => {
    const baseTotals = totals;
    if (!baseTotals.length) return baseTotals;

    const assignedSubtotalCents = items.reduce(
      (sum, item) =>
        item.assignees.length > 0 ? sum + item.totalPriceCents : sum,
      0,
    );
    const splitTargetCents =
      subtotalCents > 0
        ? Math.round((grandTotalCents * assignedSubtotalCents) / subtotalCents)
        : 0;
    const baseSplitTotalCents = baseTotals.reduce(
      (sum, [, cents]) => sum + cents,
      0,
    );
    const differenceCents = splitTargetCents - baseSplitTotalCents;
    if (differenceCents === 0) return baseTotals;

    const hasPositiveBase = baseSplitTotalCents > 0;
    const weights = baseTotals.map(([, cents]) =>
      hasPositiveBase ? cents : 1 / baseTotals.length,
    );
    const weightSum = hasPositiveBase
      ? baseSplitTotalCents
      : weights.reduce((sum, weight) => sum + weight, 0);

    const distributed = baseTotals.map(([member, cents], index) => {
      const exactShare = (differenceCents * weights[index]) / weightSum;
      const roundedTowardZero = Math.trunc(exactShare);
      return {
        member,
        baseCents: cents,
        allocatedCents: roundedTowardZero,
        remainder: exactShare - roundedTowardZero,
      };
    });

    let allocatedSum = distributed.reduce(
      (sum, row) => sum + row.allocatedCents,
      0,
    );
    let leftover = differenceCents - allocatedSum;

    if (leftover > 0) {
      const byLargestRemainder = [...distributed].sort(
        (a, b) => b.remainder - a.remainder,
      );
      for (let i = 0; i < leftover; i += 1) {
        byLargestRemainder[i % byLargestRemainder.length].allocatedCents += 1;
      }
    } else if (leftover < 0) {
      const bySmallestRemainder = [...distributed].sort(
        (a, b) => a.remainder - b.remainder,
      );
      for (let i = 0; i < Math.abs(leftover); i += 1) {
        bySmallestRemainder[i % bySmallestRemainder.length].allocatedCents -= 1;
      }
    }

    allocatedSum = distributed.reduce(
      (sum, row) => sum + row.allocatedCents,
      0,
    );
    if (allocatedSum !== differenceCents) {
      distributed[0].allocatedCents += differenceCents - allocatedSum;
    }

    return distributed.map(({ member, baseCents, allocatedCents }) => [
      member,
      baseCents + allocatedCents,
    ]) as [string, number][];
  }, [totals, items, subtotalCents, grandTotalCents]);
  const splitTotalCents = useMemo(
    () => splitTotals.reduce((sum, [, cents]) => sum + cents, 0),
    [splitTotals],
  );

  useEffect(() => {
    if (!deleteConfirmKey?.startsWith("item:")) return;
    const id = deleteConfirmKey.slice("item:".length);
    const stillExists = items.some((i) => i.id === id);
    if (!stillExists) setDeleteConfirmKey(null);
  }, [deleteConfirmKey, items]);

  useEffect(() => {
    if (!deleteConfirmKey?.startsWith("adjustment:")) return;
    const id = deleteConfirmKey.slice("adjustment:".length);
    const stillExists = customAdjustments.some((a) => a.id === id);
    if (!stillExists) setDeleteConfirmKey(null);
  }, [deleteConfirmKey, customAdjustments]);

  useEffect(() => {
    if (!editingItemId) return;
    if (!items.some((i) => i.id === editingItemId)) {
      setEditingItemId(null);
      setEditingField(null);
    }
  }, [editingItemId, items]);

  useEffect(() => {
    if (!deleteConfirmKey) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const clickedInsideConfirmedDeleteButton = !!target?.closest(
        `[data-delete-confirm-key="${deleteConfirmKey}"]`,
      );

      if (!clickedInsideConfirmedDeleteButton) {
        setDeleteConfirmKey(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [deleteConfirmKey]);

  useEffect(() => {
    const availableIds = [
      SERVICE_CHARGE_ROW_ID,
      TAX_ROW_ID,
      ...customAdjustments.map((adjustment) => adjustment.id),
    ];
    setChargeRowOrder((prev) => {
      const kept = prev.filter((id) => availableIds.includes(id));
      const missing = availableIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
  }, [customAdjustments, SERVICE_CHARGE_ROW_ID, TAX_ROW_ID]);

  const handleChargeRowDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setChargeRowOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const canOpenBillOnServer = !!splitbotApiBase && !!billApiContext;

  const saveBill = useCallback(async () => {
    setSaveBillError(null);

    // Edit mode: PATCH the existing bill.
    if (isEditMode && editingBillId && splitbotApiBase) {
      setIsSavingBill(true);
      try {
        const normalizedTitle = billTitle.trim() || "Untitled bill";
        await updateBillDetails(splitbotApiBase, editingBillId, {
          title: normalizedTitle,
          billDate,
          place: billPlace.trim() || null,
          items: items.map((it) => ({
            id: it.id,
            name: it.name,
            totalPriceCents: it.totalPriceCents,
            assignees: it.assignees,
          })),
        });
        props.onSaveComplete?.();
      } catch (e) {
        setSaveBillError(toUserFriendlyErrorMessage(e));
      } finally {
        setIsSavingBill(false);
      }
      return;
    }

    // Create mode: if a server bill already exists (from OCR), just open it.
    if (serverBillId) {
      props.onOpenBill?.(serverBillId);
      return;
    }

    if (!splitbotApiBase || !billApiContext) return;
    setIsSavingBill(true);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const title = `Bill ${day}`;
      const { billId } = await createBillSession(splitbotApiBase, {
        telegramChatId: billApiContext.telegramChatId,
        groupTitle: billApiContext.groupTitle,
        title,
        createdByUserId: launchCtx.currentUser?.id,
        billDate: day,
        place: null,
        currency: normalizeCurrencyCode(currencyCode),
      });
      setServerBillId(billId);
      props.onOpenBill?.(billId);
    } catch (e) {
      setSaveBillError(toUserFriendlyErrorMessage(e));
    } finally {
      setIsSavingBill(false);
    }
  }, [
    isEditMode,
    editingBillId,
    splitbotApiBase,
    billApiContext,
    currencyCode,
    launchCtx.currentUser?.id,
    serverBillId,
    billTitle,
    billDate,
    billPlace,
    items,
    props,
  ]);

  const saveButtonLabel = isEditMode
    ? isSavingBill
      ? "Saving..."
      : "Save changes"
    : serverBillId
      ? "Open bill"
      : "Create & open bill";

  const saveButtonDisabled =
    isSavingBill ||
    (isEditMode
      ? !splitbotApiBase
      : !serverBillId &&
        (!canOpenBillOnServer || (isFromReceiptScan && isOcrProcessing)));

  const backLabel = props.backLabel ?? (isEditMode ? "Back" : "Back to home");

  const headerTitleNode = isEditMode ? (
    <input
      value={billTitle}
      onChange={(e) => setBillTitle(e.target.value)}
      className="h-9 w-full rounded-md border bg-background px-3 text-lg font-semibold shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      placeholder="Bill title"
    />
  ) : (
    <CardTitle className="text-xl">New bill</CardTitle>
  );

  const headerDescriptionNode = isEditMode ? (
    <CardDescription className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={billDate}
        onChange={(e) => setBillDate(e.target.value)}
        className="h-8 rounded-md border bg-background px-2 text-xs"
      />
      <input
        value={billPlace}
        onChange={(e) => setBillPlace(e.target.value)}
        placeholder="Place (optional)"
        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
      />
    </CardDescription>
  ) : (
    <CardDescription>
      {groupMembers.length > AUTO_FILL_MAX_GROUP_SIZE
        ? `This group has ${groupMembers.length} members — choose who's in this bill.`
        : groupMembers.length > 0
          ? "Assign each line item to people in this bill."
          : "Tap Add members to add people by name, or open from a Telegram group to load the roster."}
    </CardDescription>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {props.onBack ? (
            <Button
              variant="outline"
              onClick={() => props.onBack?.()}
              className="w-max"
            >
              <HugeiconsIcon
                icon={ArrowLeftIcon}
                strokeWidth={1.8}
                className="size-5"
              />
              {backLabel}
            </Button>
          ) : null}
          {isEditMode && props.onCancel ? (
            <Button
              variant="outline"
              onClick={() => props.onCancel?.()}
              className="w-max"
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {showOnlyOcrStatus ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          {isOcrProcessing ? (
            <div className="flex items-center gap-3">
              <div className="flex items-end gap-1" aria-hidden>
                <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]"></span>
                <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:120ms]"></span>
                <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:240ms]"></span>
              </div>
              <p className="text-sm text-foreground">
                {ocrPhase === "uploading"
                  ? "Uploading receipt…"
                  : "Scanning receipt…"}
              </p>
            </div>
          ) : null}
          {isOcrProcessing ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/20">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70"></div>
            </div>
          ) : null}
          {ocrPhase === "error" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Couldn&apos;t scan the receipt
              </p>
              <FormErrorAlert message={ocrError} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={cn("space-y-4", showOnlyOcrStatus && "hidden")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {headerTitleNode}
            {headerDescriptionNode}
            {isFromReceiptScan ? (
              <div className="space-y-1 pt-1">
                {isOcrProcessing ? (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-end gap-1" aria-hidden>
                        <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]"></span>
                        <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:120ms]"></span>
                        <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:240ms]"></span>
                      </div>
                      <p className="text-sm text-foreground">
                        {ocrPhase === "uploading"
                          ? "Uploading receipt…"
                          : "Scanning receipt…"}
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/20">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70"></div>
                    </div>
                  </div>
                ) : null}
                {ocrPhase === "error" && ocrError ? (
                  <FormErrorAlert message={ocrError} />
                ) : null}
                {ocrPhase === "ok" ? (
                  <p className="text-sm text-muted-foreground">
                    Currency{" "}
                    <span className="font-medium text-foreground">
                      {currencyCode}
                    </span>{" "}
                    and line items were loaded from the receipt (server OCR).
                  </p>
                ) : null}
                {ocrPhase === "skipped" && !receiptFile ? (
                  <p className="text-sm text-muted-foreground">
                    Open{" "}
                    <span className="font-medium text-foreground">Scan</span> or{" "}
                    <span className="font-medium text-foreground">Upload</span>{" "}
                    from home and pick a receipt image to run OCR.
                  </p>
                ) : null}
                {ocrPhase === "idle" && !(isFromReceiptScan && receiptFile) ? (
                  <p className="text-sm text-muted-foreground">
                    Currency is taken from the receipt when it is scanned
                    (server OCR).
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="pt-2"></div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {billMembersOrdered.length === 0 ? (
              <Button
                type="button"
                className="flex-1 shrink-0 sm:w-auto"
                onClick={openMembersDrawer}
              >
                <HugeiconsIcon
                  icon={UserGroupIcon}
                  strokeWidth={1.8}
                  className="size-5"
                />
                Add members
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={openMembersDrawer}
              >
                <HugeiconsIcon
                  icon={UserGroupIcon}
                  strokeWidth={1.8}
                  className="size-5"
                />
                Members
                <Badge variant="secondary" className="ml-1">
                  {billMembersOrdered.length}
                </Badge>
              </Button>
            )}
            {!isFromReceiptScan ? (
              <Button
                type="button"
                id="bill-currency"
                variant="outline"
                className="h-9 w-full max-w-max justify-between gap-2 font-normal"
                aria-expanded={currencyDrawerOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setCurrencyFilter("");
                  setCurrencyDrawerOpen(true);
                }}
              >
                <span className="min-w-0 truncate text-left">
                  {currencyLabel}
                </span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  strokeWidth={2}
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <AutoAnimateContainer className="space-y-2">
            {items.map((item) => (
              <Card key={item.id} className="rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-lg leading-none select-none"
                      aria-hidden
                    >
                      {editingItemId === item.id && editingField === "name"
                        ? getItemDisplayEmoji({
                            name: draftItemName.trim() || item.name,
                            emoji: undefined,
                          })
                        : getItemDisplayEmoji(item)}
                    </span>
                    {editingItemId === item.id && editingField === "name" ? (
                      <input
                        autoFocus
                        value={draftItemName}
                        onChange={(e) => setDraftItemName(e.target.value)}
                        onBlur={() => {
                          const nextName = draftItemName.trim();
                          setEditingItemId(null);
                          setEditingField(null);

                          if (!nextName || nextName === item.name) return;
                          setItems((prev) =>
                            prev.map((existing) =>
                              existing.id === item.id
                                ? {
                                    ...existing,
                                    name: nextName,
                                    emoji: undefined,
                                  }
                                : existing,
                            ),
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="h-7 w-44 rounded-md border bg-background px-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    ) : (
                      <button
                        type="button"
                        className="bg-transparent border-0 p-0 font-medium hover:underline focus-visible:outline-none"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditingField("name");
                          setDraftItemName(item.name);
                        }}
                      >
                        {item.name}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {editingItemId === item.id && editingField === "price" ? (
                      <input
                        inputMode="decimal"
                        autoFocus
                        value={draftItemTotalPrice}
                        onChange={(e) => setDraftItemTotalPrice(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => {
                          const parsed = Number(draftItemTotalPrice);
                          const nextCents = Number.isFinite(parsed)
                            ? Math.round(parsed * 100)
                            : null;

                          setEditingItemId(null);
                          setEditingField(null);

                          if (nextCents === null) return;
                          if (nextCents <= 0) return;
                          if (nextCents === item.totalPriceCents) return;

                          setItems((prev) =>
                            prev.map((existing) =>
                              existing.id === item.id
                                ? { ...existing, totalPriceCents: nextCents }
                                : existing,
                            ),
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="h-7 w-28 rounded-md border bg-background px-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    ) : (
                      <button
                        type="button"
                        className="cursor-text bg-transparent border-0 p-0 focus-visible:outline-none"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditingField("price");
                          setDraftItemTotalPrice(
                            (item.totalPriceCents / 100).toFixed(2),
                          );
                        }}
                      >
                        <Badge>
                          {currencyLabel} {formatCents(item.totalPriceCents)}
                        </Badge>
                      </button>
                    )}

                    <Button
                      variant={
                        deleteConfirmKey === deleteConfirmKeyForItem(item.id)
                          ? "destructive"
                          : "outline"
                      }
                      size="xs"
                      data-delete-confirm-key={deleteConfirmKeyForItem(item.id)}
                      onClick={() => {
                        const key = deleteConfirmKeyForItem(item.id);
                        if (deleteConfirmKey === key) {
                          setItems((prev) =>
                            prev.filter((i) => i.id !== item.id),
                          );
                          setDeleteConfirmKey(null);
                          return;
                        }
                        setDeleteConfirmKey(key);
                      }}
                    >
                      {deleteConfirmKey === deleteConfirmKeyForItem(item.id) ? (
                        "Delete"
                      ) : (
                        <HugeiconsIcon
                          icon={DeleteIcon}
                          strokeWidth={1.8}
                          className="size-3.5"
                        />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="w-full">
                  <MembersCarousel
                    members={billMembersOrdered}
                    assignees={item.assignees}
                    getAvatarBgColors={(name) =>
                      memberByName.get(name)?.avatarBgColors
                    }
                    getPhotoUrl={(name) =>
                      resolveMemberPhotoUrl(memberByName.get(name))
                    }
                    onToggleMember={(member, nextPressed) => {
                      setItems((prev) =>
                        prev.map((existing) => {
                          if (existing.id !== item.id) return existing;

                          const assignees = nextPressed
                            ? [...new Set([...existing.assignees, member])]
                            : existing.assignees.filter((a) => a !== member);

                          return {
                            ...existing,
                            assignees,
                          };
                        }),
                      );
                    }}
                  />
                </div>
              </Card>
            ))}
          </AutoAnimateContainer>

          <div className="pt-1">
            <Dialog
              open={isAddingManualItem}
              onOpenChange={(open) => {
                setIsAddingManualItem(open);
                if (!open) {
                  resetManualItemForm();
                }
              }}
            >
              <DialogTrigger
                render={<Button variant="outline" className="w-full" />}
              >
                Add item
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add item</DialogTitle>
                  <DialogDescription>
                    Add a custom item and assign it after saving.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="manual-item-name"
                  >
                    Item name
                  </label>
                  <input
                    id="manual-item-name"
                    value={manualItemName}
                    onChange={(e) => {
                      setManualItemName(e.target.value);
                      setManualItemError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitManualItem();
                    }}
                    placeholder="e.g., Dessert"
                    className="h-9 rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />

                  <label
                    className="text-sm font-medium"
                    htmlFor="manual-item-total"
                  >
                    Total price
                  </label>
                  <input
                    id="manual-item-total"
                    inputMode="decimal"
                    value={manualItemTotalPrice}
                    onChange={(e) => {
                      setManualItemTotalPrice(e.target.value);
                      setManualItemError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitManualItem();
                    }}
                    placeholder="e.g., 12.50"
                    className="h-9 rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />

                  <FormErrorAlert message={manualItemError} />
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAddingManualItem(false);
                      resetManualItemForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={submitManualItem}>Add item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className={cn("space-y-2", showOnlyOcrStatus && "hidden")}>
        <div>
          <CardTitle className="text-xl">Charges & Tax</CardTitle>
          <CardDescription>Service fees, taxes, and discounts</CardDescription>
        </div>

        <Card className="rounded-xl border p-0 overflow-hidden">
          <CardContent className="divide-y px-4 py-2">
            <div className="flex items-center justify-between py-3">
              <span className="font-medium">Subtotal</span>
              <span className="font-semibold">
                {currencyLabel} {formatCents(subtotalCents)}
              </span>
            </div>

            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleChargeRowDragEnd}
            >
              <SortableContext
                items={chargeRowOrder}
                strategy={verticalListSortingStrategy}
              >
                <AutoAnimateContainer className="divide-y">
                  {chargeRowOrder.map((rowId) => {
                    if (rowId === SERVICE_CHARGE_ROW_ID) {
                      return (
                        <SortableChargeRow key={rowId} id={rowId}>
                          {isServiceChargeEnabled ? (
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-medium">
                                  Service Charge
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Applied to {currencyLabel}{" "}
                                  {formatCents(serviceChargeBaseCents)}
                                </div>
                              </div>

                              <div className="flex items-start gap-2">
                                <div className="text-right flex flex-col gap-1">
                                  <Badge>
                                    {currencyLabel}{" "}
                                    {formatCents(serviceChargeCents)}
                                  </Badge>
                                  <div className="text-xs text-muted-foreground">
                                    {editingRateField === "serviceCharge" ? (
                                      <>
                                        <input
                                          autoFocus
                                          inputMode="decimal"
                                          aria-label="Service charge percentage"
                                          value={serviceChargeRateInput}
                                          onChange={(e) =>
                                            setServiceChargeRateInput(
                                              e.target.value,
                                            )
                                          }
                                          onBlur={() => {
                                            commitPercentageInput(
                                              serviceChargeRateInput,
                                              serviceChargeRatePct,
                                              setServiceChargeRateInput,
                                              setServiceChargeRatePct,
                                            );
                                            setEditingRateField(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              e.currentTarget.blur();
                                            if (e.key === "Escape") {
                                              setServiceChargeRateInput(
                                                String(serviceChargeRatePct),
                                              );
                                              setEditingRateField(null);
                                            }
                                          }}
                                          className="h-6 w-16 rounded-md border bg-background px-2 text-right text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        />
                                        <span className="ml-1">%</span>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="hover:underline"
                                        onClick={() =>
                                          beginRateEdit("serviceCharge")
                                        }
                                      >
                                        {serviceChargeRatePct} %
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant={
                                    deleteConfirmKey ===
                                    DELETE_CONFIRM_SERVICE_CHARGE
                                      ? "destructive"
                                      : "outline"
                                  }
                                  size="xs"
                                  data-delete-confirm-key={
                                    DELETE_CONFIRM_SERVICE_CHARGE
                                  }
                                  onClick={() => {
                                    if (
                                      deleteConfirmKey ===
                                      DELETE_CONFIRM_SERVICE_CHARGE
                                    ) {
                                      setIsServiceChargeEnabled(false);
                                      setDeleteConfirmKey(null);
                                      return;
                                    }
                                    setDeleteConfirmKey(
                                      DELETE_CONFIRM_SERVICE_CHARGE,
                                    );
                                  }}
                                  aria-label="Remove service charge"
                                >
                                  {deleteConfirmKey ===
                                  DELETE_CONFIRM_SERVICE_CHARGE ? (
                                    "Delete"
                                  ) : (
                                    <HugeiconsIcon
                                      icon={DeleteIcon}
                                      strokeWidth={1.8}
                                      className="size-3.5"
                                    />
                                  )}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-sm font-medium">
                              <button
                                type="button"
                                className="hover:underline"
                                onClick={() => setIsServiceChargeEnabled(true)}
                              >
                                Add Service Charge
                              </button>
                              <div className="text-muted-foreground">
                                {editingRateField === "serviceCharge" ? (
                                  <>
                                    <input
                                      autoFocus
                                      inputMode="decimal"
                                      aria-label="Service charge percentage"
                                      value={serviceChargeRateInput}
                                      onChange={(e) =>
                                        setServiceChargeRateInput(
                                          e.target.value,
                                        )
                                      }
                                      onBlur={() => {
                                        commitPercentageInput(
                                          serviceChargeRateInput,
                                          serviceChargeRatePct,
                                          setServiceChargeRateInput,
                                          setServiceChargeRatePct,
                                        );
                                        setEditingRateField(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          e.currentTarget.blur();
                                        if (e.key === "Escape") {
                                          setServiceChargeRateInput(
                                            String(serviceChargeRatePct),
                                          );
                                          setEditingRateField(null);
                                        }
                                      }}
                                      className="h-6 w-16 rounded-md border bg-background px-2 text-right text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                    <span className="ml-1">%</span>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="hover:underline"
                                    onClick={() =>
                                      beginRateEdit("serviceCharge")
                                    }
                                  >
                                    {serviceChargeRatePct} %
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </SortableChargeRow>
                      );
                    }

                    if (rowId === TAX_ROW_ID) {
                      return (
                        <SortableChargeRow key={rowId} id={rowId}>
                          {isTaxEnabled ? (
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-medium">Tax</div>
                                <div className="text-xs text-muted-foreground">
                                  Applied to {currencyLabel}{" "}
                                  {formatCents(taxBaseCents)}
                                </div>
                              </div>

                              <div className="flex items-start gap-3">
                                <div className="text-right flex flex-col gap-1">
                                  <Badge>
                                    {currencyLabel} {formatCents(taxCents)}
                                  </Badge>

                                  <div className="text-xs text-muted-foreground">
                                    {editingRateField === "tax" ? (
                                      <>
                                        <input
                                          autoFocus
                                          inputMode="decimal"
                                          aria-label="Tax percentage"
                                          value={taxRateInput}
                                          onChange={(e) =>
                                            setTaxRateInput(e.target.value)
                                          }
                                          onBlur={() => {
                                            commitPercentageInput(
                                              taxRateInput,
                                              taxRatePct,
                                              setTaxRateInput,
                                              setTaxRatePct,
                                            );
                                            setEditingRateField(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              e.currentTarget.blur();
                                            if (e.key === "Escape") {
                                              setTaxRateInput(
                                                String(taxRatePct),
                                              );
                                              setEditingRateField(null);
                                            }
                                          }}
                                          className="h-6 w-16 rounded-md border bg-background px-2 text-right text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        />
                                        <span className="ml-1">%</span>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="hover:underline"
                                        onClick={() => beginRateEdit("tax")}
                                      >
                                        {taxRatePct} %
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant={
                                    deleteConfirmKey === DELETE_CONFIRM_TAX
                                      ? "destructive"
                                      : "outline"
                                  }
                                  size="xs"
                                  data-delete-confirm-key={DELETE_CONFIRM_TAX}
                                  onClick={() => {
                                    if (
                                      deleteConfirmKey === DELETE_CONFIRM_TAX
                                    ) {
                                      setIsTaxEnabled(false);
                                      setDeleteConfirmKey(null);
                                      return;
                                    }
                                    setDeleteConfirmKey(DELETE_CONFIRM_TAX);
                                  }}
                                  aria-label="Remove tax"
                                >
                                  {deleteConfirmKey === DELETE_CONFIRM_TAX ? (
                                    "Delete"
                                  ) : (
                                    <HugeiconsIcon
                                      icon={DeleteIcon}
                                      strokeWidth={1.8}
                                      className="size-3.5"
                                    />
                                  )}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-sm font-medium">
                              <button
                                type="button"
                                className="hover:underline"
                                onClick={() => setIsTaxEnabled(true)}
                              >
                                Add Tax
                              </button>
                              <div className="text-muted-foreground">
                                {editingRateField === "tax" ? (
                                  <>
                                    <input
                                      autoFocus
                                      inputMode="decimal"
                                      aria-label="Tax percentage"
                                      value={taxRateInput}
                                      onChange={(e) =>
                                        setTaxRateInput(e.target.value)
                                      }
                                      onBlur={() => {
                                        commitPercentageInput(
                                          taxRateInput,
                                          taxRatePct,
                                          setTaxRateInput,
                                          setTaxRatePct,
                                        );
                                        setEditingRateField(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          e.currentTarget.blur();
                                        if (e.key === "Escape") {
                                          setTaxRateInput(String(taxRatePct));
                                          setEditingRateField(null);
                                        }
                                      }}
                                      className="h-6 w-16 rounded-md border bg-background px-2 text-right text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                    <span className="ml-1">%</span>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="hover:underline"
                                    onClick={() => beginRateEdit("tax")}
                                  >
                                    {taxRatePct} %
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </SortableChargeRow>
                      );
                    }

                    const adjustment = customAdjustmentMap.get(rowId);
                    if (!adjustment) return null;
                    const amountDisplay =
                      adjustment.cents < 0
                        ? `- ${currencyLabel} ${formatCents(Math.abs(adjustment.cents))}`
                        : `${currencyLabel} ${formatCents(adjustment.cents)}`;
                    const metaLabel =
                      adjustment.amountType === "percentage"
                        ? `${adjustment.value}% of subtotal`
                        : "Fixed value";

                    return (
                      <SortableChargeRow key={adjustment.id} id={adjustment.id}>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium">{adjustment.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {metaLabel}
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <div className="text-right flex flex-col gap-1">
                              <Badge>{amountDisplay}</Badge>
                            </div>
                            <Button
                              variant={
                                deleteConfirmKey ===
                                deleteConfirmKeyForAdjustment(adjustment.id)
                                  ? "destructive"
                                  : "outline"
                              }
                              size="xs"
                              data-delete-confirm-key={deleteConfirmKeyForAdjustment(
                                adjustment.id,
                              )}
                              onClick={() => {
                                const key = deleteConfirmKeyForAdjustment(
                                  adjustment.id,
                                );
                                if (deleteConfirmKey === key) {
                                  setCustomAdjustments((prev) =>
                                    prev.filter(
                                      (entry) => entry.id !== adjustment.id,
                                    ),
                                  );
                                  setDeleteConfirmKey(null);
                                  return;
                                }
                                setDeleteConfirmKey(key);
                              }}
                              aria-label={`Remove ${adjustment.name}`}
                            >
                              {deleteConfirmKey ===
                              deleteConfirmKeyForAdjustment(adjustment.id) ? (
                                "Delete"
                              ) : (
                                <HugeiconsIcon
                                  icon={DeleteIcon}
                                  strokeWidth={1.8}
                                  className="size-3.5"
                                />
                              )}
                            </Button>
                          </div>
                        </div>
                      </SortableChargeRow>
                    );
                  })}
                </AutoAnimateContainer>
              </SortableContext>
            </DndContext>

            <Dialog
              open={isAddingAdjustment}
              onOpenChange={(open) => {
                setIsAddingAdjustment(open);
                if (!open) resetAdjustmentForm();
              }}
            >
              <DialogTrigger
                render={<Button variant="outline" className="my-3 w-full" />}
              >
                Add charge or discount
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add charge or discount</DialogTitle>
                  <DialogDescription>
                    Choose fixed amount or percentage of subtotal.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="adjustment-name"
                  >
                    Name
                  </label>
                  <input
                    id="adjustment-name"
                    value={adjustmentNameInput}
                    onChange={(e) => {
                      setAdjustmentNameInput(e.target.value);
                      setAdjustmentError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitAdjustment();
                    }}
                    placeholder="e.g., Service charge or Discount"
                    className="h-9 rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />

                  <label
                    className="text-sm font-medium"
                    htmlFor="adjustment-amount-type"
                  >
                    Amount type
                  </label>
                  <div
                    id="adjustment-amount-type"
                    className="flex items-center gap-4 rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="adjustment-amount-type"
                        value="fixed"
                        checked={adjustmentAmountType === "fixed"}
                        onChange={() => {
                          setAdjustmentAmountType("fixed");
                          setAdjustmentError(null);
                        }}
                      />
                      Fixed ({currencyLabel})
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="adjustment-amount-type"
                        value="percentage"
                        checked={adjustmentAmountType === "percentage"}
                        onChange={() => {
                          setAdjustmentAmountType("percentage");
                          setAdjustmentError(null);
                        }}
                      />
                      Percentage (%)
                    </label>
                  </div>

                  <label
                    className="text-sm font-medium"
                    htmlFor="adjustment-value"
                  >
                    Value
                  </label>
                  <input
                    id="adjustment-value"
                    inputMode="decimal"
                    value={adjustmentValueInput}
                    onChange={(e) => {
                      setAdjustmentValueInput(e.target.value);
                      setAdjustmentError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitAdjustment();
                    }}
                    placeholder={
                      adjustmentAmountType === "fixed"
                        ? "e.g., -10.00"
                        : "e.g., -5"
                    }
                    className="h-9 rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />

                  <FormErrorAlert message={adjustmentError} />
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAddingAdjustment(false);
                      resetAdjustmentForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={submitAdjustment}>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>

          <div className="flex items-center justify-between bg-input/60 px-4 py-4 text-white">
            <span className="font-semibold">Grand Total</span>
            <span className="font-semibold">
              {currencyLabel} {formatCents(grandTotalCents)}
            </span>
          </div>
        </Card>
      </div>

      <div className={cn("space-y-2", showOnlyOcrStatus && "hidden")}>
        <div>
          <CardTitle className="text-xl">Split breakdown</CardTitle>
          <CardDescription>Amount each person owes.</CardDescription>
        </div>
        <Card className="p-0 gap-0">
          <CardContent className="px-4 py-2">
            <AutoAnimateContainer className="divide-y">
              {splitTotals.map(([member, cents]) => (
                <div
                  key={member}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-2">
                    <MemberAvatar
                      name={member}
                      avatarBgColors={memberByName.get(member)?.avatarBgColors}
                      photoUrl={resolveMemberPhotoUrl(memberByName.get(member))}
                    />
                    <span>{member}</span>
                  </div>
                  <Badge variant="outline">
                    {currencyLabel} {formatCents(cents)}
                  </Badge>
                </div>
              ))}
              <div className="flex items-center justify-between py-2 font-semibold">
                <span>Total</span>
                <span>
                  {currencyLabel} {formatCents(splitTotalCents)}
                </span>
              </div>
            </AutoAnimateContainer>
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-backdrop-filter:bg-background/80",
          showOnlyOcrStatus && "hidden",
        )}
      >
        <div className="space-y-2">
          <FormErrorAlert
            title={isEditMode ? "Couldn't save the bill" : "Couldn't save the bill"}
            message={saveBillError}
          />
          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={saveButtonDisabled}
            aria-busy={isSavingBill}
            onClick={() => void saveBill()}
          >
            {saveButtonLabel}
          </Button>
          {!isEditMode && !canOpenBillOnServer ? (
            <p className="text-center text-xs text-muted-foreground">
              {!splitbotApiBase
                ? "Set VITE_SPLITBOT_API to your Splitbot API URL (build-time) to save bills on the server."
                : "Could not attach this session for saving. Open the Mini App from Telegram for group-linked bills, or ensure the page has access to storage."}
            </p>
          ) : null}
          {isEditMode && !splitbotApiBase ? (
            <p className="text-center text-xs text-muted-foreground">
              Set VITE_SPLITBOT_API to your Splitbot API URL (build-time) to save edits on the server.
            </p>
          ) : null}
        </div>
      </div>

      <Drawer open={membersDrawerOpen} onOpenChange={setMembersDrawerOpen}>
        <DrawerContent className="bg-background rounded-t-2xl p-0 border-none">
          <DrawerHeader>
            <DrawerTitle>Bill members</DrawerTitle>
            <DrawerDescription>
              {groupMembers.length <= AUTO_FILL_MAX_GROUP_SIZE &&
              groupMembers.length > 0
                ? "Small groups include everyone by default. Toggle people who aren't splitting, or add someone by name."
                : "Choose who can be assigned to line items. Add names that aren't in the group list, or use the filter to find people quickly."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 pb-2">
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="manual-member-name">
                Add member by name
              </label>
              <input
                id="manual-member-name"
                value={manualMemberInput}
                onChange={(e) => {
                  setManualMemberInput(e.target.value);
                  setManualMemberError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManualMember();
                  }
                }}
                placeholder="Add someone by name…"
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addManualMember}
              >
                Add
              </Button>
            </div>
            <FormErrorAlert message={manualMemberError} />
            <div>
              <label className="sr-only" htmlFor="member-filter">
                Filter members
              </label>
              <input
                id="member-filter"
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                placeholder="Filter by name…"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
          <div className="max-h-[min(50vh,22rem)] space-y-4 overflow-y-auto px-4 pb-4">
            {filteredManualMembersForDrawer.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Added manually
                </div>
                {filteredManualMembersForDrawer.map((member) => {
                  const checked = billMembers.includes(member);
                  const id = `bill-members-manual-${member}`;
                  return (
                    <label
                      key={`manual:${member}`}
                      htmlFor={id}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-md border p-2 pl-3 text-sm hover:bg-muted/50 ${
                        checked ? "border-border" : "border-transparent"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <MemberAvatar
                          name={member}
                          avatarBgColors={
                            memberByName.get(member)?.avatarBgColors
                          }
                          photoUrl={resolveMemberPhotoUrl(
                            memberByName.get(member),
                          )}
                        />
                        <span className="truncate">{member}</span>
                      </span>
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const nextPressed = next === true;
                          setBillMembers((prev) => {
                            if (nextPressed) {
                              if (prev.includes(member)) return prev;
                              return [...prev, member];
                            }
                            return prev.filter((m) => m !== member);
                          });
                        }}
                        aria-label={`Include ${member} in this bill`}
                        className="shrink-0 size-6 rounded-full"
                      />
                    </label>
                  );
                })}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From this group
              </div>
              {groupMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No synced Telegram list. You can still add people by name
                  above.
                  {import.meta.env.DEV ? (
                    <>
                      {" "}
                      For testing:{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        ?members=Alice,Bob
                      </code>{" "}
                      or{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        VITE_TELEGRAM_GROUP_MEMBERS
                      </code>
                      .
                    </>
                  ) : null}
                </p>
              ) : filteredGroupMembersForDrawer.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matching names.
                </p>
              ) : (
                filteredGroupMembersForDrawer.map((member) => {
                  const checked = billMembers.includes(member);
                  const id = `bill-members-group-${member}`;
                  return (
                    <label
                      key={member}
                      htmlFor={id}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-md border p-2 pl-3 text-sm hover:bg-muted/50 ${
                        checked
                          ? "border-border bg-input/30"
                          : "border-transparent"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <MemberAvatar
                          name={member}
                          avatarBgColors={
                            memberByName.get(member)?.avatarBgColors
                          }
                          photoUrl={resolveMemberPhotoUrl(
                            memberByName.get(member),
                          )}
                        />
                        <span className="truncate">{member}</span>
                      </span>
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const nextPressed = next === true;
                          setBillMembers((prev) => {
                            if (nextPressed) {
                              if (prev.includes(member)) return prev;
                              return [...prev, member];
                            }
                            return prev.filter((m) => m !== member);
                          });
                        }}
                        aria-label={`Include ${member} in this bill`}
                        className="shrink-0 size-6 rounded-full"
                      />
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DrawerFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => setMembersDrawerOpen(false)}
            >
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={currencyDrawerOpen}
        onOpenChange={(open) => {
          setCurrencyDrawerOpen(open);
          if (open) setCurrencyFilter("");
        }}
      >
        <DrawerContent className="bg-background rounded-t-2xl p-0 border-none">
          <DrawerHeader>
            <DrawerTitle>Currency</DrawerTitle>
            <DrawerDescription>
              Search by code or name, then choose the bill currency.
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 pb-2">
            <label className="sr-only" htmlFor="currency-filter">
              Filter currencies
            </label>
            <input
              id="currency-filter"
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              placeholder="Search by code or name…"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoComplete="off"
            />
          </div>
          <div className="max-h-[min(50vh,22rem)] space-y-1 overflow-y-auto px-4 pb-4">
            {filteredCurrencyOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching currencies.
              </p>
            ) : (
              filteredCurrencyOptions.map((o) => {
                const selected = o.code === currencyCode;
                return (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => {
                      setCurrencyCode(o.code);
                      setCurrencyDrawerOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left text-sm hover:bg-muted/50",
                      selected
                        ? "border-border bg-input/30"
                        : "border-transparent",
                    )}
                  >
                    <span className="min-w-0 flex-1">{o.label}</span>
                    {selected ? (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        strokeWidth={2}
                        className="size-5 shrink-0 text-foreground"
                        aria-hidden
                      />
                    ) : (
                      <span className="size-5 shrink-0" aria-hidden />
                    )}
                  </button>
                );
              })
            )}
          </div>
          <DrawerFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => setCurrencyDrawerOpen(false)}
            >
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
