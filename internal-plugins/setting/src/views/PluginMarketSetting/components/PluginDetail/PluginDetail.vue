<script setup lang="ts">
import commentLikeIcon from '@/assets/icons/comment-like.svg'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PluginDetail as SharedPluginDetail, useToast } from '@/components'
import { ACCOUNT_CHANGED_EVENT } from '@/composables/useZToolsAccount'
import type { PluginUninstallOptions, TabId } from '@/components'
import type { PluginDownloadState } from '../types'

const props = defineProps<{
  plugin: any
  isLoading?: boolean
  downloadState?: PluginDownloadState
  isRunning?: boolean
}>()

defineEmits<{
  (e: 'back'): void
  (e: 'open'): void
  (e: 'download'): void
  (e: 'upgrade'): void
  (e: 'uninstall', options: PluginUninstallOptions): void
  (e: 'kill'): void
  (e: 'open-folder'): void
  (e: 'package'): void
  (e: 'reload'): void
}>()

type CommentItem = {
  id: number
  pluginName: string
  uid: string
  nickname: string
  avatarUrl?: string
  parentId?: number | null
  parent?: CommentParent | null
  content: string
  likeCount: number
  liked: boolean
  createdAt: number
  updatedAt: number
}

type CommentParent = {
  id: number
  uid: string
  nickname: string
  avatarUrl?: string
  content: string
  deleted: boolean
  createdAt: number
}

const { success, error, warning, confirm } = useToast()
const showComments = ref(false)
const comments = ref<CommentItem[]>([])
const commentsLoading = ref(false)
const commentsError = ref('')
const commentsPage = ref(1)
const commentsPageSize = 20
const commentsTotal = ref(0)
const commentText = ref('')
const commentInputRef = ref<HTMLTextAreaElement | null>(null)
const replyTo = ref<CommentItem | null>(null)
const submittingComment = ref(false)
const likingId = ref<number | null>(null)
const deletingId = ref<number | null>(null)
const highlightedCommentId = ref<number | null>(null)
const currentUsername = ref('')

onMounted(() => {
  void loadLoginDefaults()
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
})

watch(
  () => props.plugin?.name,
  () => {
    commentsPage.value = 1
    comments.value = []
    commentsTotal.value = 0
    replyTo.value = null
    commentText.value = ''
    if (showComments.value) {
      void loadComments()
    }
  }
)

function handleTabSwitch(tabId: TabId): void {
  showComments.value = tabId === 'comments'
  if (tabId === 'comments') {
    nextTick(() => loadComments())
  }
}

async function loadComments(): Promise<void> {
  if (!props.plugin?.name) return
  commentsLoading.value = true
  commentsError.value = ''
  try {
    const result = await window.ztools.internal.fetchPluginMarketComments(
      props.plugin.name,
      commentsPage.value,
      commentsPageSize
    )
    if (result.success && result.data) {
      comments.value = result.data.items || []
      commentsTotal.value = result.data.page?.total || 0
    } else {
      commentsError.value = result.error || '评论加载失败'
    }
  } catch (err: any) {
    commentsError.value = err?.message || '评论加载失败'
  } finally {
    commentsLoading.value = false
  }
}

async function loadLoginDefaults(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetConfig()
    if (result.success && result.config) {
      currentUsername.value = result.config.username || ''
    } else {
      currentUsername.value = ''
    }
  } catch {
    currentUsername.value = ''
  }
}

function handleAccountChanged(): void {
  void loadLoginDefaults()
}

async function submitComment(): Promise<void> {
  const content = commentText.value.trim()
  if (!content) {
    warning('请输入评论内容')
    return
  }
  submittingComment.value = true
  try {
    const result = await window.ztools.internal.createPluginMarketComment({
      pluginName: props.plugin.name,
      content,
      parentId: replyTo.value?.id || null
    })
    if (result.success) {
      success(replyTo.value ? '回复已发布' : '评论已发布')
      commentText.value = ''
      replyTo.value = null
      commentsPage.value = 1
      await loadComments()
      return
    }
    if (result.authRequired) {
      promptLogin()
      return
    }
    error(result.error || '评论发布失败')
  } catch (err: any) {
    error(err?.message || '评论发布失败')
  } finally {
    submittingComment.value = false
  }
}

async function toggleLike(item: CommentItem): Promise<void> {
  likingId.value = item.id
  try {
    const result = await window.ztools.internal.togglePluginMarketCommentLike(item.id)
    if (result.success && result.data) {
      item.liked = result.data.liked
      item.likeCount = result.data.likeCount
      return
    }
    if (result.authRequired) {
      promptLogin()
      return
    }
    error(result.error || '操作失败')
  } catch (err: any) {
    error(err?.message || '操作失败')
  } finally {
    likingId.value = null
  }
}

async function deleteComment(item: CommentItem): Promise<void> {
  if (!isOwnComment(item) || deletingId.value) return
  const confirmed = await confirm({
    title: '删除评论',
    message: '确认删除这条评论？',
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!confirmed) return
  deletingId.value = item.id
  try {
    const result = await window.ztools.internal.deletePluginMarketComment(item.id)
    if (result.success) {
      success('评论已删除')
      await loadComments()
      return
    }
    if (result.authRequired) {
      promptLogin()
      return
    }
    error(result.error || '删除失败')
  } catch (err: any) {
    error(err?.message || '删除失败')
  } finally {
    deletingId.value = null
  }
}

function selectReply(item: CommentItem): void {
  replyTo.value = item
  commentText.value = ''
  nextTick(() => {
    commentInputRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    commentInputRef.value?.focus()
  })
}

function cancelReply(): void {
  replyTo.value = null
}

function promptLogin(): void {
  warning('请先在左下角注册/登录后再操作')
}

function nextCommentsPage(): void {
  if (commentsPage.value * commentsPageSize >= commentsTotal.value) return
  commentsPage.value += 1
  void loadComments()
}

function previousCommentsPage(): void {
  if (commentsPage.value <= 1) return
  commentsPage.value -= 1
  void loadComments()
}

function formatTime(value: number): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function authorOf(parentId?: number | null): string {
  if (!parentId) return ''
  return comments.value.find((item) => item.id === parentId)?.nickname || ''
}

function isOwnComment(item: CommentItem): boolean {
  return Boolean(currentUsername.value && item.uid === currentUsername.value)
}

function parentOf(item: CommentItem): CommentParent | null {
  if (item.parent) return item.parent
  if (!item.parentId) return null
  const localParent = comments.value.find((comment) => comment.id === item.parentId)
  if (!localParent) return null
  return {
    id: localParent.id,
    uid: localParent.uid,
    nickname: localParent.nickname,
    avatarUrl: localParent.avatarUrl,
    content: localParent.content,
    deleted: false,
    createdAt: localParent.createdAt
  }
}

function displayCommentText(value?: string): string {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text || '原评论已删除'
}

function focusParentComment(parentId?: number | null): void {
  if (!parentId) return
  const target = document.getElementById(`plugin-comment-${parentId}`)
  if (!target) {
    warning('原评论不在当前页')
    return
  }
  highlightedCommentId.value = parentId
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  window.setTimeout(() => {
    if (highlightedCommentId.value === parentId) {
      highlightedCommentId.value = null
    }
  }, 1600)
}
</script>

<template>
  <SharedPluginDetail
    :plugin="plugin"
    :is-loading="isLoading"
    :download-state="downloadState"
    :is-running="isRunning"
    :show-comments="true"
    :show-commands="false"
    :show-data="false"
    :show-size="true"
    :show-download-count="true"
    @back="$emit('back')"
    @open="$emit('open')"
    @download="$emit('download')"
    @upgrade="$emit('upgrade')"
    @uninstall="$emit('uninstall', $event)"
    @kill="$emit('kill')"
    @open-folder="$emit('open-folder')"
    @package="$emit('package')"
    @reload="$emit('reload')"
    @tab-switch="handleTabSwitch"
  >
    <template #extra-tabs>
      <div v-if="showComments" class="tab-panel comments-panel">
        <div class="comment-composer">
          <div v-if="replyTo" class="reply-target">
            <div class="reply-target-content">
              <span>回复 @{{ replyTo.uid }}</span>
              <p>{{ displayCommentText(replyTo.content) }}</p>
            </div>
            <button type="button" @click="cancelReply">取消</button>
          </div>
          <textarea
            ref="commentInputRef"
            v-model="commentText"
            class="comment-input"
            maxlength="1000"
            placeholder="写下你的评论"
          ></textarea>
          <div class="comment-actions">
            <span>{{ commentText.trim().length }}/1000</span>
            <button
              class="comment-primary"
              type="button"
              :disabled="submittingComment"
              @click="submitComment"
            >
              {{ submittingComment ? '发布中' : replyTo ? '发布回复' : '发布评论' }}
            </button>
          </div>
        </div>

        <div v-if="commentsLoading" class="comments-state">加载中...</div>
        <div v-else-if="commentsError" class="comments-state error">{{ commentsError }}</div>
        <div v-else-if="!comments.length" class="comments-state">暂无评论</div>
        <div v-else class="comment-list">
          <div
            v-for="item in comments"
            :id="`plugin-comment-${item.id}`"
            :key="item.id"
            class="comment-item"
            :class="{ highlighted: highlightedCommentId === item.id }"
          >
            <img v-if="item.avatarUrl" class="comment-avatar" :src="item.avatarUrl" alt="" />
            <div v-else class="comment-avatar">{{ item.nickname.slice(0, 1).toUpperCase() }}</div>
            <div class="comment-body">
              <div class="comment-meta">
                <strong>{{ item.nickname }}</strong>
                <span v-if="item.parentId"
                  >回复 @{{ parentOf(item)?.nickname || authorOf(item.parentId) || '用户' }}</span
                >
                <time>{{ formatTime(item.createdAt) }}</time>
              </div>
              <button
                v-if="item.parentId"
                class="comment-reference"
                type="button"
                @click="focusParentComment(item.parentId)"
              >
                <img
                  v-if="parentOf(item)?.avatarUrl"
                  class="reference-avatar"
                  :src="parentOf(item)?.avatarUrl"
                  alt=""
                />
                <div v-else class="reference-avatar">
                  {{
                    (parentOf(item)?.nickname || authorOf(item.parentId) || '用户')
                      .slice(0, 1)
                      .toUpperCase()
                  }}
                </div>
                <div class="reference-body">
                  <strong
                    >@{{ parentOf(item)?.nickname || authorOf(item.parentId) || '用户' }}</strong
                  >
                  <p>{{ displayCommentText(parentOf(item)?.content) }}</p>
                </div>
              </button>
              <div class="comment-content">{{ item.content }}</div>
              <div class="comment-toolbar">
                <button
                  type="button"
                  class="comment-icon-button"
                  :class="{ active: item.liked }"
                  :disabled="likingId === item.id"
                  :title="item.liked ? '取消点赞' : '点赞'"
                  :aria-label="item.liked ? '取消点赞' : '点赞'"
                  @click="toggleLike(item)"
                >
                  <span
                    class="comment-like-icon"
                    :style="{ '--comment-like-icon': `url(${commentLikeIcon})` }"
                    aria-hidden="true"
                  ></span>
                  <span>{{ item.likeCount || 0 }}</span>
                </button>
                <button type="button" @click="selectReply(item)">回复</button>
                <button
                  v-if="isOwnComment(item)"
                  type="button"
                  class="comment-danger-button"
                  :disabled="deletingId === item.id"
                  @click="deleteComment(item)"
                >
                  {{ deletingId === item.id ? '删除中' : '删除' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="commentsTotal > commentsPageSize" class="comment-pagination">
          <button type="button" :disabled="commentsPage <= 1" @click="previousCommentsPage">
            上一页
          </button>
          <span>{{ commentsPage }} / {{ Math.ceil(commentsTotal / commentsPageSize) }}</span>
          <button
            type="button"
            :disabled="commentsPage * commentsPageSize >= commentsTotal"
            @click="nextCommentsPage"
          >
            下一页
          </button>
        </div>
      </div>
    </template>
  </SharedPluginDetail>
</template>

<style scoped>
.tab-panel {
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.comments-panel {
  position: relative;
  padding: 0 12px 16px;
}

.comment-composer {
  display: grid;
  gap: 10px;
  margin-bottom: 18px;
}

.reply-target {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
}

.reply-target-content {
  min-width: 0;
}

.reply-target-content span {
  color: var(--text-primary);
  font-weight: 600;
}

.reply-target-content p {
  display: -webkit-box;
  overflow: hidden;
  margin: 4px 0 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  color: var(--text-secondary);
  line-height: 1.5;
}

.reply-target button,
.comment-toolbar button,
.comment-pagination button {
  border: none;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
}

.comment-input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}

.comment-input {
  min-height: 104px;
  padding: 10px 12px;
  resize: vertical;
  line-height: 1.6;
}

.comment-actions,
.comment-pagination {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.comment-actions span,
.comment-pagination span {
  color: var(--text-secondary);
  font-size: 12px;
}

.comment-primary {
  border: none;
  border-radius: 8px;
  background: var(--primary-color);
  color: #fff;
  cursor: pointer;
  padding: 8px 14px;
}

.comment-primary:disabled,
.comment-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.comments-state {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: var(--text-secondary);
}

.comments-state.error {
  color: var(--danger-color, #d03050);
}

.comment-list {
  display: grid;
  gap: 14px;
}

.comment-item {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  border-bottom: 1px solid var(--border-color);
  border-radius: 8px;
  padding-bottom: 14px;
  transition:
    background 0.2s,
    box-shadow 0.2s;
}

.comment-item.highlighted {
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary-color) 10%, transparent);
}

.comment-avatar {
  align-items: center;
  display: flex;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-weight: 600;
  object-fit: cover;
}

.comment-body {
  min-width: 0;
}

.comment-meta {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}

.comment-meta strong {
  color: var(--text-primary);
  font-size: 13px;
}

.comment-reference {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: inherit;
  cursor: pointer;
  margin: 8px 0 10px;
  padding: 8px 10px;
  text-align: left;
}

.comment-reference:hover {
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--border-color));
}

.reference-avatar {
  align-items: center;
  display: flex;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  object-fit: cover;
}

.reference-body {
  min-width: 0;
}

.reference-body strong {
  display: block;
  color: var(--text-primary);
  font-size: 12px;
  margin-bottom: 2px;
}

.reference-body p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.comment-content {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
  line-height: 1.6;
}

.comment-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.comment-toolbar button {
  padding: 0;
}

.comment-toolbar button.active {
  color: var(--danger-color, #d03050);
}

.comment-icon-button {
  align-items: center;
  display: inline-flex;
  gap: 4px;
  min-width: 34px;
  line-height: 1;
  color: var(--text-secondary);
}

.comment-like-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  background: currentColor;
  flex-shrink: 0;
  mask: var(--comment-like-icon) center / contain no-repeat;
  -webkit-mask: var(--comment-like-icon) center / contain no-repeat;
}

.comment-danger-button {
  color: var(--danger-color, #d03050) !important;
}

.comment-danger-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.comment-pagination {
  justify-content: center;
  margin-top: 16px;
}
</style>
