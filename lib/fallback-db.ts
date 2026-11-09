import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DB_FILE = path.join(os.tmpdir(), "shotinger-resilient-db.json");

interface TableStore {
  [table: string]: any[];
}

let cache: TableStore | null = null;

function loadStore(): TableStore {
  if (cache) return cache;
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, "utf8");
      cache = JSON.parse(content);
      return cache!;
    }
  } catch {}
  cache = {
    user: [],
    mailbox: [],
    contact: [],
    template: [],
    campaign: [],
    campaignRecipient: [],
    emailMessage: [],
    scheduledJob: [],
    emailLog: [],
    auditLog: [],
    formTemplate: [],
    websiteFormJob: [],
    followUpRule: [],
    workerLease: [],
  };
  return cache;
}

function saveStore() {
  if (!cache) return;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {}
}

function matchesFilter(item: any, where: any): boolean {
  if (!where || typeof where !== "object") return true;
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    // Handle AND / OR / NOT
    if (key === "AND") {
      if (Array.isArray(value) && !value.every((w) => matchesFilter(item, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (Array.isArray(value) && !value.some((w) => matchesFilter(item, w))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matchesFilter(item, value)) return false;
      continue;
    }

    const itemVal = item[key];

    // Compound unique keys (e.g. userId_email: { userId, email })
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      const opKeys = ["in", "notIn", "not", "contains", "startsWith", "gte", "lte", "gt", "lt", "mode"];
      const hasOp = Object.keys(value).some((k) => opKeys.includes(k));
      if (!hasOp) {
        if (!matchesFilter(item, value)) return false;
        continue;
      }
    }

    // Sub-operators: in, notIn, not, contains, startsWith, gt, gte, lt, lte
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value && Array.isArray((value as any).in)) {
        if (!(value as any).in.includes(itemVal)) return false;
        continue;
      }
      if ("notIn" in value && Array.isArray((value as any).notIn)) {
        if ((value as any).notIn.includes(itemVal)) return false;
        continue;
      }
      if ("not" in value) {
        if (itemVal === (value as any).not) return false;
        continue;
      }
      if ("contains" in value) {
        const mode = (value as any).mode;
        const needle = String((value as any).contains || "");
        const haystack = String(itemVal || "");
        if (mode === "insensitive") {
          if (!haystack.toLowerCase().includes(needle.toLowerCase())) return false;
        } else {
          if (!haystack.includes(needle)) return false;
        }
        continue;
      }
      if ("startsWith" in value) {
        if (!String(itemVal || "").startsWith(String((value as any).startsWith || ""))) return false;
        continue;
      }
      if ("gte" in value) {
        const t1 = itemVal instanceof Date ? itemVal.getTime() : new Date(itemVal).getTime();
        const t2 = (value as any).gte instanceof Date ? (value as any).gte.getTime() : new Date((value as any).gte).getTime();
        if (isNaN(t1) || isNaN(t2) ? itemVal < (value as any).gte : t1 < t2) return false;
        continue;
      }
      if ("lte" in value) {
        const t1 = itemVal instanceof Date ? itemVal.getTime() : new Date(itemVal).getTime();
        const t2 = (value as any).lte instanceof Date ? (value as any).lte.getTime() : new Date((value as any).lte).getTime();
        if (isNaN(t1) || isNaN(t2) ? itemVal > (value as any).lte : t1 > t2) return false;
        continue;
      }
      if ("gt" in value) {
        const t1 = itemVal instanceof Date ? itemVal.getTime() : new Date(itemVal).getTime();
        const t2 = (value as any).gt instanceof Date ? (value as any).gt.getTime() : new Date((value as any).gt).getTime();
        if (isNaN(t1) || isNaN(t2) ? itemVal <= (value as any).gt : t1 <= t2) return false;
        continue;
      }
      if ("lt" in value) {
        const t1 = itemVal instanceof Date ? itemVal.getTime() : new Date(itemVal).getTime();
        const t2 = (value as any).lt instanceof Date ? (value as any).lt.getTime() : new Date((value as any).lt).getTime();
        if (isNaN(t1) || isNaN(t2) ? itemVal >= (value as any).lt : t1 >= t2) return false;
        continue;
      }
    }

    // Direct comparison
    if (typeof itemVal === "string" && typeof value === "string") {
      // Case insensitive match for emails
      if (key.toLowerCase().includes("email")) {
        if (itemVal.toLowerCase() !== value.toLowerCase()) return false;
        continue;
      }
    }

    if (itemVal !== value) return false;
  }
  return true;
}

function applySelectOrInclude(item: any, select?: any, include?: any, modelName?: string): any {
  if (!item) return null;
  const store = loadStore();
  let result = { ...item };

  if (select && typeof select === "object") {
    const selected: Record<string, any> = {};
    for (const [k, v] of Object.entries(select)) {
      if (v) {
        if (typeof v === "object" && (v as any).select) {
          // Relation selection
          selected[k] = applySelectOrInclude(resolveRelation(item, k, modelName), (v as any).select);
        } else {
          selected[k] = result[k];
        }
      }
    }
    return selected;
  }

  if (include && typeof include === "object") {
    for (const [k, v] of Object.entries(include)) {
      if (v) {
        const related = resolveRelation(item, k, modelName);
        if (typeof v === "object" && (v as any).select) {
          result[k] = Array.isArray(related)
            ? related.map((r) => applySelectOrInclude(r, (v as any).select))
            : applySelectOrInclude(related, (v as any).select);
        } else {
          result[k] = related;
        }
      }
    }
  }

  return result;
}

function resolveRelation(item: any, relationField: string, modelName?: string): any {
  const store = loadStore();
  if (relationField === "user" && item.userId) {
    return (store.user || []).find((u) => u.id === item.userId) || null;
  }
  if (relationField === "mailbox" && item.mailboxId) {
    return (store.mailbox || []).find((m) => m.id === item.mailboxId) || null;
  }
  if (relationField === "contact" && item.contactId) {
    return (store.contact || []).find((c) => c.id === item.contactId) || null;
  }
  if (relationField === "template" && item.templateId) {
    return (store.template || []).find((t) => t.id === item.templateId) || null;
  }
  if (relationField === "campaign" && item.campaignId) {
    return (store.campaign || []).find((c) => c.id === item.campaignId) || null;
  }
  if (relationField === "recipients" && item.id) {
    return (store.campaignRecipient || []).filter((r) => r.campaignId === item.id);
  }
  return null;
}

export function createFallbackModel(modelName: string) {
  return {
    async findUnique(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      const found = list.find((item) => matchesFilter(item, args.where));
      return applySelectOrInclude(found, args.select, args.include, modelName);
    },

    async findFirst(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      const found = list.find((item) => matchesFilter(item, args.where));
      return applySelectOrInclude(found, args.select, args.include, modelName);
    },

    async findMany(args: any = {}) {
      const store = loadStore();
      let list = [...(store[modelName] || [])];

      if (args.where) {
        list = list.filter((item) => matchesFilter(item, args.where));
      }

      if (args.orderBy) {
        const orderKey = Object.keys(args.orderBy)[0];
        const orderDir = args.orderBy[orderKey];
        if (orderKey) {
          list.sort((a, b) => {
            const va = a[orderKey];
            const vb = b[orderKey];
            if (va < vb) return orderDir === "desc" ? 1 : -1;
            if (va > vb) return orderDir === "desc" ? -1 : 1;
            return 0;
          });
        }
      }

      const skip = args.skip || 0;
      const take = args.take !== undefined ? args.take : list.length;
      const sliced = list.slice(skip, skip + take);

      return sliced.map((item) => applySelectOrInclude(item, args.select, args.include, modelName));
    },

    async create(args: any = {}) {
      const store = loadStore();
      if (!store[modelName]) store[modelName] = [];

      const now = new Date();
      const record = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...args.data,
      };

      store[modelName].push(record);
      saveStore();
      return applySelectOrInclude(record, args.select, args.include, modelName);
    },

    async createMany(args: any = {}) {
      const store = loadStore();
      if (!store[modelName]) store[modelName] = [];
      const items = Array.isArray(args.data) ? args.data : [args.data];
      const now = new Date();
      let count = 0;
      for (const d of items) {
        const record = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...d,
        };
        store[modelName].push(record);
        count++;
      }
      saveStore();
      return { count };
    },

    async update(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      const index = list.findIndex((item) => matchesFilter(item, args.where));
      if (index === -1) {
        // Fallback: create if missing
        return this.create({ data: { ...args.where, ...args.data }, select: args.select });
      }

      const updated = {
        ...list[index],
        ...args.data,
        updatedAt: new Date(),
      };
      list[index] = updated;
      saveStore();
      return applySelectOrInclude(updated, args.select, args.include, modelName);
    },

    async updateMany(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        if (matchesFilter(list[i], args.where)) {
          list[i] = {
            ...list[i],
            ...args.data,
            updatedAt: new Date(),
          };
          count++;
        }
      }
      if (count > 0) saveStore();
      return { count };
    },

    async upsert(args: any = {}) {
      const existing = await this.findFirst({ where: args.where });
      if (existing) {
        return this.update({ where: args.where, data: args.update, select: args.select });
      }
      return this.create({ data: args.create, select: args.select });
    },

    async delete(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      const index = list.findIndex((item) => matchesFilter(item, args.where));
      if (index === -1) return null;
      const removed = list.splice(index, 1)[0];
      saveStore();
      return removed;
    },

    async deleteMany(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      const initialLen = list.length;
      store[modelName] = list.filter((item) => !matchesFilter(item, args.where));
      const count = initialLen - store[modelName].length;
      if (count > 0) saveStore();
      return { count };
    },

    async count(args: any = {}) {
      const store = loadStore();
      const list = store[modelName] || [];
      if (!args.where) return list.length;
      return list.filter((item) => matchesFilter(item, args.where)).length;
    },
  };
}
