import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Callable, Any, Dict
from uuid import UUID
from enum import Enum
from concurrent.futures import ThreadPoolExecutor
import time


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class QueueTask:
    id: str
    task_type: str
    payload: Dict[str, Any]
    callback: Callable
    on_failure: Optional[Callable] = None
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3


class TaskQueue:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(
        self,
        max_concurrent: int = 3,
        retry_delay: float = 5.0,
    ):
        if self._initialized:
            return

        self.max_concurrent = max_concurrent
        self.retry_delay = retry_delay
        self.queue: deque = deque()
        self.queue_lock = threading.Lock()
        self.running_tasks: Dict[str, QueueTask] = {}
        self.running_lock = threading.Lock()
        self.completed_tasks: Dict[str, QueueTask] = {}
        self.completed_lock = threading.Lock()
        self.semaphore = threading.Semaphore(max_concurrent)
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent)
        self.is_running = False
        self.worker_thread: Optional[threading.Thread] = None
        self._initialized = True
        self._stats = {
            "total_submitted": 0,
            "total_completed": 0,
            "total_failed": 0,
        }

    def start(self):
        if self.is_running:
            return

        self.is_running = True
        self.worker_thread = threading.Thread(target=self._worker, daemon=True)
        self.worker_thread.start()
        print(f"[TaskQueue] Started with max_concurrent={self.max_concurrent}")

    def stop(self):
        self.is_running = False
        if self.executor:
            self.executor.shutdown(wait=False)
        print("[TaskQueue] Stopped")

    def submit(
        self,
        task_id: str,
        task_type: str,
        payload: Dict[str, Any],
        callback: Callable,
        on_failure: Optional[Callable] = None,
    ) -> QueueTask:
        task = QueueTask(
            id=task_id,
            task_type=task_type,
            payload=payload,
            callback=callback,
            on_failure=on_failure,
        )

        with self.queue_lock:
            self.queue.append(task)
            self._stats["total_submitted"] += 1
            queue_size = len(self.queue)

        with self.running_lock:
            running_size = len(self.running_tasks)

        print(f"[TaskQueue] Task {task_id} submitted. Queue: {queue_size}, Running: {running_size}")

        if not self.is_running:
            self.start()

        return task

    def get_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self.running_lock:
            if task_id in self.running_tasks:
                task = self.running_tasks[task_id]
                return {
                    "status": task.status.value,
                    "created_at": task.created_at.isoformat(),
                    "started_at": task.started_at.isoformat() if task.started_at else None,
                }

        with self.completed_lock:
            if task_id in self.completed_tasks:
                task = self.completed_tasks[task_id]
                return {
                    "status": task.status.value,
                    "created_at": task.created_at.isoformat(),
                    "started_at": task.started_at.isoformat() if task.started_at else None,
                    "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                    "error": task.error,
                }

        with self.queue_lock:
            for i, task in enumerate(self.queue):
                if task.id == task_id:
                    return {
                        "status": task.status.value,
                        "created_at": task.created_at.isoformat(),
                        "queue_position": i + 1,
                    }

        return None

    def get_stats(self) -> Dict[str, Any]:
        with self.queue_lock:
            queue_size = len(self.queue)
        with self.running_lock:
            running_size = len(self.running_tasks)
        with self.completed_lock:
            completed_size = len(self.completed_tasks)

        return {
            "queue_size": queue_size,
            "running_tasks": running_size,
            "completed_tasks": completed_size,
            "max_concurrent": self.max_concurrent,
            **self._stats,
        }

    def get_queue_position(self, task_id: str) -> Optional[int]:
        with self.queue_lock:
            for i, task in enumerate(self.queue):
                if task.id == task_id:
                    return i + 1
        return None

    def _worker(self):
        while self.is_running:
            try:
                task = None
                with self.queue_lock:
                    if self.queue:
                        task = self.queue.popleft()

                if task:
                    self.executor.submit(self._execute_task, task)
                else:
                    time.sleep(0.5)

            except Exception as e:
                print(f"[TaskQueue] Worker error: {e}")
                time.sleep(1)

    def _execute_task(self, task: QueueTask):
        acquired = self.semaphore.acquire(blocking=True)
        if not acquired:
            with self.queue_lock:
                self.queue.appendleft(task)
            return

        try:
            task.status = TaskStatus.RUNNING
            task.started_at = datetime.now()

            with self.running_lock:
                self.running_tasks[task.id] = task

            print(f"[TaskQueue] Executing task {task.id}")

            result = task.callback(task.payload)

            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now()
            self._stats["total_completed"] += 1
            print(f"[TaskQueue] Task {task.id} completed")

        except Exception as e:
            task.retry_count += 1
            task.error = str(e)

            if task.retry_count < task.max_retries:
                print(f"[TaskQueue] Task {task.id} failed, retrying ({task.retry_count}/{task.max_retries})")
                task.status = TaskStatus.PENDING
                time.sleep(self.retry_delay * task.retry_count)
                with self.queue_lock:
                    self.queue.appendleft(task)
            else:
                task.status = TaskStatus.FAILED
                task.completed_at = datetime.now()
                self._stats["total_failed"] += 1
                print(f"[TaskQueue] Task {task.id} failed permanently: {e}")

                if task.on_failure:
                    try:
                        task.on_failure(task.payload, str(e))
                    except Exception as fe:
                        print(f"[TaskQueue] Failure callback error: {fe}")

        finally:
            self.semaphore.release()

            with self.running_lock:
                if task.id in self.running_tasks:
                    del self.running_tasks[task.id]

            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED]:
                with self.completed_lock:
                    self.completed_tasks[task.id] = task
                    if len(self.completed_tasks) > 100:
                        oldest_key = next(iter(self.completed_tasks))
                        del self.completed_tasks[oldest_key]


task_queue = TaskQueue(max_concurrent=3)


def get_task_queue() -> TaskQueue:
    return task_queue
