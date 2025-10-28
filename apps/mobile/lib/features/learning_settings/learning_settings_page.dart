import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shikaku_mobile/database/repository/question_repository.dart';
import 'package:shikaku_mobile/models/choice.dart';
import 'package:shikaku_mobile/models/question_extensions.dart';

import '../../core/app_logger.dart';
import '../../core/task_priority_manager.dart';
import '../../firebase/analytics_events.dart';
import '../../firebase/user_properties.dart';
import '../../services/dialog_preference_service.dart';
import '../../services/question_service.dart';
import '../../services/review_service.dart';
import '../../services/session_service.dart';
import '../../widgets/home_app_bar.dart';
import '../../widgets/resume_learning_dialog.dart';
import '../question_screen/models/question_display_options.dart';
import '../question_screen/models/question_review_state.dart';
import '../question_screen/models/question_screen_callbacks.dart';
import '../question_screen/models/question_screen_config.dart';
import '../question_screen/models/question_timer_state.dart';
import '../question_screen/question_screen.dart';

/// 学習設定画面
class LearningSettingsPage extends ConsumerStatefulWidget {
  // 試験期ID

  const LearningSettingsPage({
    super.key,
    required this.domain,
    required this.domainTitle,
    required this.selectedCategories,
    required this.selectedSubcategories,
    required this.selectedYears,
    required this.selectedExamPeriodIds, // 必須パラメータに変更, super.key,, super.key,
  });
  final String domain;
  final String domainTitle;
  final Set<String> selectedCategories;
  final Set<String> selectedSubcategories;
  final Set<String> selectedYears;
  final Set<int> selectedExamPeriodIds;

  @override
  ConsumerState<LearningSettingsPage> createState() =>
      _LearningSettingsPageState();
}

class _LearningSettingsPageState extends ConsumerState<LearningSettingsPage> {
  bool _timerEnabled = true; // デフォルトON
  bool _shuffleQuestions = false;
  bool _unansweredOnly = true; // デフォルトON
  bool _hasUnansweredQuestions = true; // 未実施問題の存在フラグ
  int _unansweredCount = 0; // 未実施問題数
  int? _domainQuestionCount; // 分野別学習の実際の問題数
  final ScrollController _pageScrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // ウィジェットツリーの構築後に実行（Riverpodのルール）
    Future(() {
      _checkUnansweredQuestions();
      _checkDomainQuestionCount();
    });
  }

  @override
  Widget build(BuildContext context) {
    // 年度別学習かどうかを判定（選択された年度が1つのみで、カテゴリが空の場合）
    final bool isYearlyLearning =
        widget.selectedYears.length == 1 &&
        widget.selectedCategories.isEmpty &&
        widget.selectedSubcategories.isEmpty;

    return Scaffold(
      appBar: HomeAppBar.basic(
        title: isYearlyLearning ? '学習設定' : '${widget.domainTitle} - 学習設定',
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              controller: _pageScrollController,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildLearningSettingsCard(),
                  const SizedBox(height: 24),
                  _buildOptionsSection(),
                ],
              ),
            ),
          ),
          _buildBottomActions(),
        ],
      ),
    );
  }

  Widget _buildLearningSettingsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '学習設定',
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text('年度: ${widget.selectedYears.join(', ')}年度'),
            if (widget.selectedCategories.isNotEmpty ||
                widget.selectedSubcategories.isNotEmpty) ...[
              Text('分野: ${widget.domainTitle}'),
              Text(
                '分類: ${widget.selectedCategories.length + widget.selectedSubcategories.length}件',
              ),
            ],
            _buildQuestionCountDisplay(),
          ],
        ),
      ),
    );
  }

  Widget _buildOptionsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'オプション設定',
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),

        // タイマー表示
        Card(
          child: SwitchListTile(
            title: const Text('タイマー表示'),
            subtitle: const Text('1問1分の目安・時間配分を意識した学習'),
            value: _timerEnabled,
            onChanged: (value) {
              setState(() {
                _timerEnabled = value;
              });
            },
            secondary: const Icon(Icons.timer),
          ),
        ),

        const SizedBox(height: 16),

        // 問題順序シャッフル
        Card(
          child: SwitchListTile(
            title: const Text('問題順序シャッフル'),
            subtitle: const Text('出題順序をランダムにする'),
            value: _shuffleQuestions,
            onChanged: (value) {
              setState(() {
                _shuffleQuestions = value;
              });
            },
            secondary: const Icon(Icons.shuffle),
          ),
        ),

        const SizedBox(height: 16),

        // 未実施問題フィルター
        Card(
          child: SwitchListTile(
            title: const Text('未実施問題のみ'),
            subtitle: Text(
              _hasUnansweredQuestions ? 'まだ回答していない問題のみを出題します' : 'すべての問題を回答済みです',
            ),
            value: _unansweredOnly,
            onChanged: _hasUnansweredQuestions
                ? (value) {
                    setState(() {
                      _unansweredOnly = value;
                    });
                  }
                : null,
            secondary: const Icon(Icons.filter_list),
          ),
        ),
      ],
    );
  }

  Widget _buildBottomActions() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 4,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: () {
                // 年度選択画面に戻る
                // カテゴリとサブカテゴリの情報を保持して遷移
                final params = <String>[];
                for (final category in widget.selectedCategories) {
                  params.add('categories=${Uri.encodeComponent(category)}');
                }
                for (final subcategory in widget.selectedSubcategories) {
                  params.add(
                    'subcategories=${Uri.encodeComponent(subcategory)}',
                  );
                }
                final path = '/year-selection/${widget.domain}';
                final fullPath = params.isEmpty
                    ? path
                    : '$path?${params.join('&')}';
                context.go(fullPath);
              },
              child: const Text('戻る'),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ElevatedButton(
              onPressed: _startLearning,
              child: const Text('学習開始'),
            ),
          ),
        ],
      ),
    );
  }

  /// 未実施問題数をチェック
  Future<void> _checkUnansweredQuestions() async {
    try {
      final questionService = ref.read(questionServiceProvider);
      int unansweredCount = 0;

      if (widget.selectedCategories.isEmpty &&
          widget.selectedSubcategories.isEmpty) {
        // 年度別学習の場合
        for (final yearStr in widget.selectedYears) {
          final year = int.tryParse(yearStr) ?? 2025;
          final count = await questionService.getUnansweredQuestionCount(
            year: year,
          );
          unansweredCount += count;
        }
      } else {
        // 分野別学習の場合
        final domainDisplayName = _getDomainDisplayName(widget.domain);
        final count = await questionService.getUnansweredQuestionCount(
          domainName: domainDisplayName,
        );
        unansweredCount += count;
      }

      if (mounted) {
        setState(() {
          _unansweredCount = unansweredCount;
          _hasUnansweredQuestions = unansweredCount > 0;
          // 未実施問題がない場合は強制OFF
          if (!_hasUnansweredQuestions) {
            _unansweredOnly = false;
          }
        });
      }
    } catch (e) {
      // エラー時は安全側として未実施問題ありとして扱う
      if (mounted) {
        setState(() {
          _hasUnansweredQuestions = true;
        });
      }
    }
  }

  /// 分野名の表示用変換
  String _getDomainDisplayName(String domainKey) {
    switch (domainKey) {
      case 'strategy':
        return 'ストラテジ系';
      case 'management':
        return 'マネジメント系';
      case 'technology':
        return 'テクノロジ系';
      default:
        return domainKey;
    }
  }

  /// 分野別学習の実際の問題数を取得
  Future<void> _checkDomainQuestionCount() async {
    try {
      // 年度別学習の場合はスキップ
      if (widget.selectedCategories.isEmpty &&
          widget.selectedSubcategories.isEmpty) {
        return;
      }

      final questionService = ref.read(questionServiceProvider);
      final domainDisplayName = _getDomainDisplayName(widget.domain);

      // 実際の問題数を取得（未実施フィルターなし）
      final questions = await questionService.getDomainQuestions(
        domainName: domainDisplayName,
        limit: 1000, // 十分大きな値を設定して全件取得
        offset: 0,
        unansweredOnly: false,
      );

      if (mounted) {
        setState(() {
          _domainQuestionCount = questions.length;
        });
      }
    } catch (e) {
      // エラー時は推定値を使用
    }
  }

  Widget _buildQuestionCountDisplay() {
    final estimatedCount = _estimateQuestionCount();
    final isYearlyLearning =
        widget.selectedCategories.isEmpty &&
        widget.selectedSubcategories.isEmpty;

    // 未実施問題フィルターが有効な場合（年度別・分野別共通）
    if (_unansweredOnly && _hasUnansweredQuestions) {
      if (_unansweredCount <= 100) {
        return Text('対象 $_unansweredCount問（未実施問題のみ）');
      } else {
        return const Text('対象 100問（未実施問題のみ、最大100問まで）');
      }
    }

    // 未実施問題フィルターが無効な場合
    // 年度別学習の場合
    if (isYearlyLearning) {
      return Text('対象 $estimatedCount問');
    }

    // 分野別学習の場合
    if (estimatedCount <= 100) {
      return Text('対象 $estimatedCount問');
    } else {
      return Text('対象 $estimatedCount問（最大100問まで）');
    }
  }

  int _estimateQuestionCount() {
    // 未実施問題フィルターが有効な場合は未実施問題数を返す
    if (_unansweredOnly && _hasUnansweredQuestions) {
      return _unansweredCount;
    }

    // 年度別学習の場合：年度数に基づく推定
    final yearCount = widget.selectedYears.length;
    final categoryCount =
        widget.selectedCategories.length + widget.selectedSubcategories.length;

    if (categoryCount == 0) {
      // 年度別学習の場合：年度数に基づく推定
      return yearCount * 100; // 1年度あたり100問
    } else {
      // 分野別学習の場合：実際の問題数を取得するため、非同期で処理
      // このメソッドは同期的な値を返す必要があるため、初期値として適切な推定値を返す
      // 実際の問題数は _checkDomainQuestionCount() で非同期に取得される
      return _domainQuestionCount ??
          (yearCount * categoryCount * 20); // より現実的な推定値
    }
  }

  Future<void> _startLearning() async {
    // 学習セッションの設定を作成
    final sessionConfig = LearningConfig(
      domain: widget.domain,
      domainTitle: widget.domainTitle,
      selectedCategories: widget.selectedCategories,
      selectedSubcategories: widget.selectedSubcategories,
      selectedYears: widget.selectedYears,
      selectedExamPeriodIds: widget.selectedExamPeriodIds, // 🆕 試験期IDを渡す
      timerEnabled: _timerEnabled,
      shuffleQuestions: _shuffleQuestions,
      unansweredOnly: _unansweredOnly,
    );

    // ANR回避：画面遷移を遅延実行（復習モードと同じパターン）
    await Future.delayed(const Duration(milliseconds: 200));

    if (!mounted) return;

    // postFrameCallbackで確実にUIスレッドを解放
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      // 学習画面に遷移（新規セッション開始フラグを設定）
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => LearningScreen(
            config: sessionConfig,
            isNewSession: true, // 新規セッション開始
          ),
        ),
      );
    });
  }
}

/// 学習設定
class LearningConfig {
  // 復習モードの並び順

  LearningConfig({
    required this.domain,
    required this.domainTitle,
    required this.selectedCategories,
    required this.selectedSubcategories,
    required this.selectedYears,
    required this.selectedExamPeriodIds,
    required this.shuffleQuestions, // 必須パラメータに変更
    this.timerEnabled = true,
    this.unansweredOnly = true,
    this.isReviewMode = false,
    this.reviewSortOrder,
  });

  /// 復習モード用のファクトリコンストラクタ
  factory LearningConfig.forReview({required String sortOrder}) {
    return LearningConfig(
      domain: 'review', // 復習モード識別用
      domainTitle: '復習モード',
      selectedCategories: {},
      selectedSubcategories: {},
      selectedYears: {},
      selectedExamPeriodIds: {}, // 復習モードでは不要
      timerEnabled: false, // 復習モードではタイマー不要
      shuffleQuestions: false, // 並び順は別途制御
      unansweredOnly: false,
      isReviewMode: true,
      reviewSortOrder: sortOrder,
    );
  }
  final String domain;
  final String domainTitle;
  final Set<String> selectedCategories;
  final Set<String> selectedSubcategories;
  final Set<String> selectedYears;
  final Set<int> selectedExamPeriodIds; // 試験期ID（年度+期間の正確な識別用）
  final bool timerEnabled; // タイマー表示の有効/無効
  final bool shuffleQuestions;
  final bool unansweredOnly; // 未実施問題のみ
  final bool isReviewMode; // 復習モードかどうか
  final String? reviewSortOrder;
}

/// 学習画面（問題出題）
class LearningScreen extends ConsumerStatefulWidget {
  // 新規セッション開始フラグ

  const LearningScreen({
    required this.config,
    super.key,
    this.sessionId,
    this.isNewSession = false,
  });
  final LearningConfig config;
  final String? sessionId; // 続きから学習用のセッションID
  final bool isNewSession;

  @override
  ConsumerState<LearningScreen> createState() => _LearningScreenState();
}

class _LearningScreenState extends ConsumerState<LearningScreen>
    with WidgetsBindingObserver {
  // Riverpodプロバイダーから取得するサービスは、使用時に ref.read() で取得
  QuestionService get _questionService => ref.read(questionServiceProvider);
  ReviewService get _reviewService => ref.read(reviewServiceProvider);
  SessionService get _sessionService => ref.read(sessionServiceProvider);

  List<QuestionWithDetails> _questions = [];
  int _currentIndex = 0;
  bool _isLoading = true;
  bool _isAnswered = false;
  bool _isCorrect = false;
  int? _selectedChoice;
  int? _timerSeconds;
  Timer? _timer;
  bool _isInReviewList = false;

  // セッション管理用の変数
  String? _currentSessionId;
  Map<String, int> _currentAnswers = {};
  int _correctCount = 0;

  // ナビゲーションバー用のScrollController
  final ScrollController _navigationScrollController = ScrollController();

  @override
  void initState() {
    super.initState();

    // ライフサイクル監視を開始
    WidgetsBinding.instance.addObserver(this);

    // UI描画後にセッション初期化と問題読み込み（アプリ起動をブロックしない）
    // ANR対策: awaitせず非同期で実行
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        AppLogger.i(
          '初期化開始 - isReviewMode: ${widget.config.isReviewMode}',
          tag: 'LearningScreen',
        );

        // ANR対策: メインスレッドをブロックしないよう、awaitせずに実行
        _initializeSessionAndLoadQuestions()
            .then((_) {
              AppLogger.i(
                '問題読み込み完了',
                tag: 'LearningScreen',
                data: {'count': _questions.length},
              );

              if (mounted) {
                _checkAndShowResumeDialog();

                AppLogger.i('初期化完了', tag: 'LearningScreen');
              }
            })
            .catchError((e, stackTrace) {
              AppLogger.e(
                '初期化エラー',
                tag: 'LearningScreen',
                error: e,
                stackTrace: stackTrace,
              );
            });
      }
    });

    // タイマー表示が有効な場合、タイマーを開始
    if (widget.config.timerEnabled) {
      _startTimer();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _navigationScrollController.dispose();
    // セッションの進捗を保存
    _saveCurrentState();
    // ライフサイクル監視を停止
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// セッション初期化と問題読み込み
  Future<void> _initializeSessionAndLoadQuestions() async {
    await _initializeSession();
    await _loadQuestions();
  }

  /// セッション初期化
  Future<void> _initializeSession() async {
    // 復習モードではセッション処理をスキップ（PRD: 再開不可）
    if (widget.config.isReviewMode) return;

    try {
      // 続きから学習の場合は指定されたセッションIDを使用
      if (widget.sessionId != null) {
        final session = await _sessionService.getSession(widget.sessionId!);
        if (session != null) {
          await _restoreSession(session);
          return;
        }
      }

      // 新規セッションの場合は既存セッションをチェックしない
      if (widget.isNewSession) {
        // 既存セッションチェックをスキップ
      } else {
        // 既存のセッションをチェック
        final existingSession = await _checkExistingSession();
        if (existingSession != null) {
          // 既存セッションを復元
          await _restoreSession(existingSession);
          return;
        }
      }

      // 学習モードを判定
      final mode = widget.config.selectedCategories.isEmpty
          ? SessionMode.yearly
          : SessionMode.domain;

      // セッションデータを作成
      final sessionData = {
        'domain': widget.config.domain,
        'domainTitle': widget.config.domainTitle,
        'selectedCategories': widget.config.selectedCategories.toList(),
        'selectedSubcategories': widget.config.selectedSubcategories.toList(),
        'selectedYears': widget.config.selectedYears.toList(),
        'selectedExamPeriodIds': widget.config.selectedExamPeriodIds.toList(),
        'timerEnabled': widget.config.timerEnabled,
        'shuffleQuestions': widget.config.shuffleQuestions,
        'unansweredOnly': widget.config.unansweredOnly,
        'currentIndex': 0,
        'answers': <String, int>{},
        'reviewFlags': <String, bool>{},
        'progress': {'answered': 0, 'correct': 0, 'total': 0},
        'questionIds': <String>[], // 問題IDリストを保存（シャッフル対応）
      };

      // セッションを作成
      final session = await _sessionService.createSession(
        mode: mode,
        data: sessionData,
      );

      _currentSessionId = session.id;
    } catch (e) {
      // エラーハンドリング
    }
  }

  /// 既存セッションをチェック
  Future<SessionData?> _checkExistingSession() async {
    try {
      final allSessions = await _sessionService.getAllSessions();
      final activeSessions = allSessions
          .where((session) => session.status == SessionStatus.active)
          .toList();

      // 現在の学習設定と一致するセッションを探す
      for (final session in activeSessions) {
        final data = session.data;

        // 学習モードを判定
        final mode = widget.config.selectedCategories.isEmpty
            ? SessionMode.yearly
            : SessionMode.domain;

        // クローズ済みセッションは除外
        if (session.status == SessionStatus.closed) {
          continue;
        }

        if (session.mode == mode &&
            data['domain'] == widget.config.domain &&
            _listEquals(
              data['selectedCategories'] ?? [],
              widget.config.selectedCategories.toList(),
            ) &&
            _listEquals(
              data['selectedSubcategories'] ?? [],
              widget.config.selectedSubcategories.toList(),
            ) &&
            _listEquals(
              data['selectedYears'] ?? [],
              widget.config.selectedYears.toList(),
            ) &&
            _listEquals(
              data['selectedExamPeriodIds'] ?? [],
              widget.config.selectedExamPeriodIds.toList(),
            )) {
          return session;
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /// セッション復元
  Future<void> _restoreSession(SessionData session) async {
    try {
      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _restoreSession 開始',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionId': session.id,
            'sessionStatus': session.status.name,
            '_currentAnswers（復元前）': _currentAnswers.toString(),
            '_currentIndex（復元前）': _currentIndex,
          },
        );
      }

      // 完了済みセッション（closed）の場合は復元を拒否
      if (session.status == SessionStatus.closed) {
        if (kDebugMode) {
          AppLogger.w(
            '[SessionSaveDebug] 完了済みの学習セッションです。復元を拒否します',
            tag: 'SessionSaveDebug',
            data: {
              'timestamp': DateTime.now().toIso8601String(),
              'sessionId': session.id,
            },
          );
        }
        // ホーム画面に戻る
        if (mounted) {
          Navigator.of(context).pop();
        }
        return;
      }

      _currentSessionId = session.id;

      // セッションデータから状態を復元
      final data = session.data;

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] セッションデータ読み込み',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'session.data.currentIndex': data['currentIndex'],
            'session.data.answers': data['answers']?.toString() ?? 'null',
            'session.data.progress': data['progress']?.toString() ?? 'null',
          },
        );
      }

      _currentIndex = data['currentIndex'] ?? 0;
      _currentAnswers = Map<String, int>.from(data['answers'] ?? {});
      _correctCount = data['progress']?['correct'] ?? 0;

      // 現在の問題の状態を復元
      final currentQuestionState = data['currentQuestionState'] ?? {};
      _isAnswered = currentQuestionState['isAnswered'] ?? false;
      _isCorrect = currentQuestionState['isCorrect'] ?? false;
      _selectedChoice = currentQuestionState['selectedChoice'];

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] セッション復元完了',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'セッションID': _currentSessionId,
            'ステータス': session.status.name,
            '現在の問題インデックス': _currentIndex,
            '回答済み問題数': _currentAnswers.length,
            '正解数': _correctCount,
            'isAnswered': _isAnswered,
            'isCorrect': _isCorrect,
            'selectedChoice': _selectedChoice,
            '_currentAnswers（復元後）': _currentAnswers.toString(),
          },
        );
      }
    } catch (e) {
      if (kDebugMode) {
        AppLogger.e(
          '[SessionSaveDebug] セッション復元エラー',
          tag: 'SessionSaveDebug',
          error: e,
          data: {'timestamp': DateTime.now().toIso8601String()},
        );
      }
    }
  }

  /// リストの等価性チェック
  bool _listEquals(List<dynamic> list1, List<dynamic> list2) {
    if (list1.length != list2.length) return false;
    for (int i = 0; i < list1.length; i++) {
      if (list1[i] != list2[i]) return false;
    }
    return true;
  }

  Future<void> _loadQuestions() async {
    try {
      AppLogger.d(
        '開始 - isReviewMode: ${widget.config.isReviewMode}',
        tag: '_loadQuestions',
      );

      // ANR回避: 重い処理の場合のみTaskPriorityManager使用
      // 復習モードは軽量（最大100問）なので直接実行
      // シャッフルONの場合は全件読み込みが発生するため、TaskPriorityManager使用
      final useTaskManager =
          !widget.config.isReviewMode && widget.config.shuffleQuestions;

      AppLogger.v(
        'TaskPriorityManager使用判断',
        tag: '_loadQuestions',
        data: {
          'enabled': useTaskManager,
          'isReviewMode': widget.config.isReviewMode,
          'shuffleQuestions': widget.config.shuffleQuestions,
          'reason': useTaskManager ? 'シャッフル処理のため' : '軽量処理のため不要',
        },
      );

      Future<void> loadQuestionsTask() async {
        // 復習モードの場合
        if (widget.config.isReviewMode) {
          AppLogger.v('復習モード - 問題ID取得開始', tag: '_loadQuestions');

          // 1. ReviewServiceから復習問題のIDリストを取得
          final reviewIds = await _reviewService.getReviewQuestionIds();
          AppLogger.d(
            '復習モード - 問題ID取得完了',
            tag: '_loadQuestions',
            data: {'count': reviewIds.length},
          );

          if (reviewIds.isEmpty) {
            setState(() {
              _questions = [];
              _isLoading = false;
            });
            return;
          }

          // 2. ReviewServiceから復習履歴を取得
          AppLogger.v('復習モード - 履歴取得開始', tag: '_loadQuestions');
          final reviewHistory = await _reviewService.getReviewHistory();
          AppLogger.v('復習モード - 履歴取得完了', tag: '_loadQuestions');

          // 3. QuestionRepositoryから復習問題を取得（並び順適用済み）
          AppLogger.v('復習モード - 問題詳細取得開始', tag: '_loadQuestions');
          final repository = QuestionRepository();
          final questions = await repository.getReviewQuestionsWithSort(
            ids: reviewIds,
            sortOrder: widget.config.reviewSortOrder ?? 'newest',
            reviewHistory: reviewHistory,
          );
          AppLogger.d(
            '復習モード - 問題詳細取得完了',
            tag: '_loadQuestions',
            data: {'count': questions.length},
          );

          setState(() {
            _questions = questions;
            _isLoading = false;
          });

          // 現在の問題が復習リストに含まれているかチェック
          if (_questions.isNotEmpty) {
            _checkReviewListStatus();
          }

          return;
        }

        // セッション復元時: 保存された問題IDリストから問題を読み込む
        if (_currentSessionId != null) {
          final session = await _sessionService.getSession(_currentSessionId!);
          if (session != null) {
            final savedQuestionIds =
                session.data['questionIds'] as List<dynamic>?;
            if (savedQuestionIds != null && savedQuestionIds.isNotEmpty) {
              // 保存された問題IDリストから問題を取得
              final repository = QuestionRepository();
              final idList = savedQuestionIds
                  .map((id) => int.tryParse(id.toString()))
                  .whereType<int>()
                  .toList();
              final questionsMap = {
                for (final q in await repository.getQuestionsByIds(idList))
                  q.id: q,
              };

              // IDリストの順序に従って問題を並べ替え
              final questions = idList
                  .where(questionsMap.containsKey)
                  .map((id) => questionsMap[id]!)
                  .toList();

              setState(() {
                _questions = questions;
                _isLoading = false;
              });

              // 現在の問題が復習リストに含まれているかチェック
              if (_questions.isNotEmpty) {
                _checkReviewListStatus();
              }

              return;
            }
          }
        }

        // 年度別学習の場合
        if (widget.config.selectedCategories.isEmpty &&
            widget.config.selectedSubcategories.isEmpty) {
          // 試験期IDを使用（年度+期間を正確に識別）
          final int examPeriodId = widget.config.selectedExamPeriodIds.first;

          // ✅ 対策A: シャッフル時の全件読み込み
          List<QuestionWithDetails> questions;
          if (widget.config.shuffleQuestions) {
            // シャッフルONの場合：全件取得してシャッフル後に100問選択
            questions = await _questionService.getYearlyQuestions(
              examPeriodId: examPeriodId,
              limit: null, // 制限なし（全件取得）
              offset: 0,
              unansweredOnly: widget.config.unansweredOnly,
            );

            // 全件をシャッフル
            questions.shuffle();

            // 上位100問を取得
            questions = questions.take(100).toList();
          } else {
            // シャッフルOFFの場合：100問のみ取得（効率的）
            questions = await _questionService.getYearlyQuestions(
              examPeriodId: examPeriodId,
              limit: 100,
              offset: 0,
              unansweredOnly: widget.config.unansweredOnly,
            );
          }

          setState(() {
            _questions = questions;
            _isLoading = false;
          });

          // 現在の問題が復習リストに含まれているかチェック
          if (_questions.isNotEmpty) {
            _checkReviewListStatus();
          }

          // 問題読み込み後にセッションデータを更新
          if (_currentSessionId != null) {
            await _updateSessionProgress();
          }
        } else {
          // 分野別学習の場合
          if (widget.config.domain.isEmpty) {
            throw ArgumentError('Domain is required for domain-based learning');
          }
          final domainDisplayName = _getDomainDisplayName(widget.config.domain);

          // ✅ 対策A: シャッフル時の全件読み込み
          List<QuestionWithDetails> questions;
          if (widget.config.shuffleQuestions) {
            // シャッフルONの場合：全件取得してシャッフル後に100問選択
            questions = await _questionService.getDomainQuestions(
              domainName: domainDisplayName,
              limit: null, // 制限なし（全件取得）
              offset: 0,
              unansweredOnly: widget.config.unansweredOnly,
            );

            // 全件をシャッフル
            questions.shuffle();

            // 上位100問を取得
            questions = questions.take(100).toList();
          } else {
            // シャッフルOFFの場合：100問のみ取得（効率的）
            questions = await _questionService.getDomainQuestions(
              domainName: domainDisplayName,
              limit: 100,
              offset: 0,
              unansweredOnly: widget.config.unansweredOnly,
            );
          }

          setState(() {
            _questions = questions;
            _isLoading = false;
          });

          // 現在の問題が復習リストに含まれているかチェック
          if (_questions.isNotEmpty) {
            _checkReviewListStatus();
          }

          // 問題読み込み後にセッションデータを更新
          if (_currentSessionId != null) {
            await _updateSessionProgress();
          }
        }
      }

      // 条件付きでTaskPriorityManager使用
      if (useTaskManager) {
        AppLogger.d('TaskPriorityManager経由で実行', tag: '_loadQuestions');
        final taskManager = TaskPriorityManager();
        await taskManager.executeHighPriority(loadQuestionsTask);
      } else {
        AppLogger.d('直接実行（軽量処理）', tag: '_loadQuestions');
        await loadQuestionsTask();
      }
    } catch (e, stackTrace) {
      AppLogger.e(
        '_loadQuestionsエラー',
        tag: 'LearningScreen',
        error: e,
        stackTrace: stackTrace,
      );
      setState(() {
        _isLoading = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('問題の読み込みに失敗しました: $e')));
      }
    }
  }

  void _startTimer() {
    _timerSeconds = 60; // 1問1分
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        if (_timerSeconds! > 0) {
          _timerSeconds = _timerSeconds! - 1;
        } else {
          timer.cancel();
          // 時間切れの処理（オプション）
        }
      });
    });
  }

  void _resetTimer() {
    _timer?.cancel();
    if (widget.config.timerEnabled) {
      _startTimer();
    }
  }

  // 復習リストの状態をチェック
  Future<void> _checkReviewListStatus() async {
    if (_questions.isEmpty) return;

    final currentQuestion = _questions[_currentIndex];
    final isInReviewList = await _reviewService.isInReviewList(
      currentQuestion.id.toString(),
    );

    if (mounted) {
      setState(() {
        _isInReviewList = isInReviewList;
      });
    }
  }

  // 末尾近傍で次ブロックを先読み（100問固定読み込みにより無効化）
  Future<void> _maybePrefetchNextBlock() async {
    // 動的読み込みを廃止し、100問固定読み込み方式に変更
    // PRD 12.4.1 問題読み込み仕様（固定読み込み方式）に準拠
    return;
  }

  // 復習リストに追加
  Future<void> _addToReview() async {
    if (_questions.isEmpty) return;

    final currentQuestion = _questions[_currentIndex];
    final success = await _reviewService.addToReviewList(
      currentQuestion.id.toString(),
    );

    if (success && mounted) {
      setState(() {
        _isInReviewList = true;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('復習リストに追加しました'),
          duration: Duration(milliseconds: 800),
        ),
      );
    }
  }

  // 復習リストから削除
  Future<void> _removeFromReview(int questionId) async {
    final success = await _reviewService.removeFromReviewList(
      questionId.toString(),
    );

    if (success && mounted) {
      setState(() {
        _isInReviewList = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('復習リストから削除しました'),
          duration: Duration(milliseconds: 800),
        ),
      );
    }
  }

  // 復習モード専用：復習リストから削除して次の問題へ
  Future<void> _removeFromReviewAndGoNext(int questionId) async {
    // 1. 問題リストから削除（ナビバーから即座に消える）
    final currentQuestionIndex = _questions.indexWhere(
      (q) => q.id == questionId,
    );
    if (currentQuestionIndex == -1) return;

    setState(() {
      _questions.removeAt(currentQuestionIndex);
      // 現在のインデックスを調整
      if (_currentIndex >= _questions.length && _questions.isNotEmpty) {
        _currentIndex = _questions.length - 1;
      }
    });

    // 2. 復習リストから削除
    await _reviewService.removeFromReviewList(questionId.toString());

    // 3. フィードバックのSnackBar表示
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Row(
            children: [
              Icon(Icons.check_circle, color: Colors.white),
              SizedBox(width: 8),
              Expanded(child: Text('復習リストから削除しました')),
            ],
          ),
          duration: Duration(milliseconds: 800),
          backgroundColor: Colors.red,
        ),
      );
    }

    // 4. 次の問題へ移動または完了
    if (_questions.isEmpty) {
      // すべて削除した場合、完了ダイアログを表示
      _showCompletionDialog();
    } else {
      // 削除後の位置を調整
      if (currentQuestionIndex >= _questions.length) {
        // 最後の問題を削除した場合、前の問題に移動
        setState(() {
          _currentIndex = _questions.length - 1;
          _isAnswered = false;
          _isCorrect = false;
          _selectedChoice = null;
        });
      } else {
        // 次の問題へ移動（同じインデックスで新しい問題）
        setState(() {
          _currentIndex = currentQuestionIndex;
          _isAnswered = false;
          _isCorrect = false;
          _selectedChoice = null;
        });
      }
    }
  }

  void _answerQuestion(int choiceIndex) {
    if (_isAnswered) return;

    final question = _questions[_currentIndex];
    final correctChoiceIndex = _getCorrectChoiceIndex(question);
    final isCorrect = choiceIndex == correctChoiceIndex;

    if (kDebugMode) {
      AppLogger.d(
        '[SessionSaveDebug] _answerQuestion 開始',
        tag: 'SessionSaveDebug',
        data: {
          'timestamp': DateTime.now().toIso8601String(),
          'questionId': question.id,
          'questionIndex': _currentIndex,
          'choiceIndex': choiceIndex,
          'isCorrect': isCorrect,
          '_currentAnswers（更新前）': _currentAnswers.toString(),
        },
      );
    }

    setState(() {
      _isAnswered = true;
      _isCorrect = isCorrect;
      _selectedChoice = choiceIndex;
    });

    // タイマーを停止
    _timer?.cancel();

    if (kDebugMode) {
      AppLogger.d(
        '[SessionSaveDebug] setState完了、_saveProgress呼び出し前',
        tag: 'SessionSaveDebug',
        data: {
          'timestamp': DateTime.now().toIso8601String(),
          'questionId': question.id,
          '_isAnswered': _isAnswered,
          '_selectedChoice': _selectedChoice,
        },
      );
    }

    // 進捗を保存（非同期で実行、UIをブロックしない）
    unawaited(
      _saveProgress(isCorrect).catchError((e) {
        if (kDebugMode) {
          AppLogger.e(
            '[SessionSaveDebug] _saveProgress エラー',
            tag: 'SessionSaveDebug',
            error: e,
            data: {
              'timestamp': DateTime.now().toIso8601String(),
              'questionId': question.id,
            },
          );
        }
        // UIには影響させないが、エラーログは出力
      }),
    );

    // Analytics: 問題解答イベント送信
    unawaited(
      AnalyticsEventsHelper.logQuestionAnswered(
        questionId: question.id,
        isCorrect: isCorrect,
        answerTimeSeconds: 0, // タイマー機能がないため0
        categoryDomain: question.category.domainName,
      ),
    );

    // Analytics: ユーザープロパティ更新（非同期）
    unawaited(_updateAnalyticsUserProperties());

    // 回答後の自動進行は無効化（ユーザーが手動で「次の問題」をタップする）
    // 解説を読む時間を考慮して、自動進行は行わない
  }

  /// セッション進捗を更新
  Future<void> _updateSessionProgress() async {
    if (_currentSessionId == null) {
      if (kDebugMode) {
        AppLogger.w(
          '[SessionSaveDebug] _updateSessionProgress スキップ（sessionId null）',
          tag: 'SessionSaveDebug',
          data: {'timestamp': DateTime.now().toIso8601String()},
        );
      }
      return;
    }

    try {
      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _updateSessionProgress 開始',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionId': _currentSessionId,
            'currentIndex': _currentIndex,
            'answersCount': _currentAnswers.length,
            'answers': _currentAnswers.toString(),
          },
        );
      }

      final sessionData = {
        // 学習設定を保持
        'domain': widget.config.domain,
        'domainTitle': widget.config.domainTitle,
        'selectedCategories': widget.config.selectedCategories.toList(),
        'selectedSubcategories': widget.config.selectedSubcategories.toList(),
        'selectedYears': widget.config.selectedYears.toList(),
        'timerEnabled': widget.config.timerEnabled,
        'shuffleQuestions': widget.config.shuffleQuestions,
        'unansweredOnly': widget.config.unansweredOnly,
        // 進捗データ
        'currentIndex': _currentIndex,
        'answers': _currentAnswers,
        'progress': {
          'answered': _currentAnswers.length,
          'correct': _correctCount,
          'total': _questions.length,
        },
        'currentQuestionState': {
          'isAnswered': _isAnswered,
          'isCorrect': _isCorrect,
          'selectedChoice': _selectedChoice,
        },
        // 問題IDリストを保存（シャッフル対応）
        'questionIds': _questions.map((q) => q.id.toString()).toList(),
      };

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] saveSessionData呼び出し前',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionData.answers': sessionData['answers'].toString(),
            'sessionData.currentIndex': sessionData['currentIndex'],
          },
        );
      }

      await _sessionService.saveSessionData(_currentSessionId!, sessionData);

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] saveSessionData完了',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionId': _currentSessionId,
          },
        );
      }
    } catch (e) {
      if (kDebugMode) {
        AppLogger.e(
          '[SessionSaveDebug] _updateSessionProgress エラー',
          tag: 'SessionSaveDebug',
          error: e,
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionId': _currentSessionId,
          },
        );
      }
      // エラーハンドリング
    }
  }

  Future<void> _saveProgress(bool isCorrect) async {
    try {
      final question = _questions[_currentIndex];

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _saveProgress 開始',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'questionId': question.id,
            'isCorrect': isCorrect,
            '_currentAnswers（更新前）': _currentAnswers.toString(),
            '_correctCount': _correctCount,
          },
        );
      }

      // 回答を記録
      _currentAnswers[question.id.toString()] = _selectedChoice ?? 0;

      // 正解数を更新
      if (isCorrect) {
        _correctCount++;
      }

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _currentAnswers更新完了',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'questionId': question.id,
            '_currentAnswers（更新後）': _currentAnswers.toString(),
            '_correctCount': _correctCount,
          },
        );
      }

      // データベースに進捗を記録
      // 選択したインデックスを選択肢文字列に変換
      final selectedChoiceString =
          _selectedChoice != null && _selectedChoice! < question.choices.length
          ? question.choices[_selectedChoice!].choiceNo
          : 'ア';

      try {
        await _questionService.recordAnswer(
          questionId: question.id,
          domainId: question.category.domainId,
          selectedChoice: selectedChoiceString,
          correctChoice: question.correctChoice,
        );

        if (kDebugMode) {
          AppLogger.d(
            '[SessionSaveDebug] recordAnswer完了',
            tag: 'SessionSaveDebug',
            data: {
              'timestamp': DateTime.now().toIso8601String(),
              'questionId': question.id,
            },
          );
        }
      } catch (recordError) {
        if (kDebugMode) {
          AppLogger.e(
            '[SessionSaveDebug] recordAnswer エラー',
            tag: 'SessionSaveDebug',
            error: recordError,
          );
        }
        rethrow;
      }

      // セッション進捗を更新
      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _updateSessionProgress呼び出し前',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            '_currentSessionId': _currentSessionId,
            '_currentAnswers': _currentAnswers.toString(),
          },
        );
      }

      try {
        await _updateSessionProgress();

        if (kDebugMode) {
          AppLogger.d(
            '[SessionSaveDebug] _updateSessionProgress完了',
            tag: 'SessionSaveDebug',
            data: {'timestamp': DateTime.now().toIso8601String()},
          );
        }
      } catch (sessionError) {
        if (kDebugMode) {
          AppLogger.e(
            '[SessionSaveDebug] _updateSessionProgress エラー',
            tag: 'SessionSaveDebug',
            error: sessionError,
          );
        }
        // セッション更新エラーは致命的ではないので続行
      }
    } catch (e) {
      if (kDebugMode) {
        AppLogger.e(
          '[SessionSaveDebug] _saveProgress エラー',
          tag: 'SessionSaveDebug',
          error: e,
        );
      }
      // エラーを再スローして上位で処理
      rethrow;
    }
  }

  void _nextQuestion() {
    if (_currentIndex < _questions.length - 1) {
      // 現在の状態を保存してから次へ
      _saveCurrentState();

      setState(() {
        _currentIndex++;
        // 次の問題の状態を復元
        _restoreCurrentQuestionState();
      });
      _resetTimer();
      _checkReviewListStatus(); // 復習リストの状態を更新
      // ナビゲーションバーを現在の問題にスクロール
      _scrollToCurrentQuestion();
      _maybePrefetchNextBlock();
    } else {
      // 学習完了
      _showCompletionDialog();
    }
  }

  void _previousQuestion() {
    if (_currentIndex > 0) {
      // 現在の状態を保存してから前へ
      _saveCurrentState();

      setState(() {
        _currentIndex--;
        // 前の問題の状態を復元
        _restoreCurrentQuestionState();
      });
      _resetTimer();
      _checkReviewListStatus(); // 復習リストの状態を更新
      // ナビゲーションバーを現在の問題にスクロール
      _scrollToCurrentQuestion();
    }
  }

  /// 指定した問題番号に移動
  void _goToQuestion(int questionIndex) {
    if (questionIndex >= 0 &&
        questionIndex < _questions.length &&
        questionIndex != _currentIndex) {
      // 現在の状態を保存してから移動
      _saveCurrentState();

      setState(() {
        _currentIndex = questionIndex;
        // 移動先の問題の状態を復元
        _restoreCurrentQuestionState();
      });
      _resetTimer();
      _checkReviewListStatus(); // 復習リストの状態を更新
      // ナビゲーションバーを現在の問題にスクロール
      _scrollToCurrentQuestion();
      _maybePrefetchNextBlock();
    }
  }

  /// ナビゲーションバーを現在の問題位置にスクロールする
  void _scrollToCurrentQuestion() {
    if (!_navigationScrollController.hasClients) return;

    // UI更新完了後にスクロール処理を実行
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_navigationScrollController.hasClients) return;

      // 各問題番号ボタンの幅（32px + 8px margin）
      const double itemWidth = 40;
      // ビューポートの幅を取得
      final double viewportWidth =
          _navigationScrollController.position.viewportDimension;

      // 現在の問題を中央に表示するためのオフセットを計算
      final double targetOffset =
          (_currentIndex * itemWidth) - (viewportWidth / 2) + (itemWidth / 2);

      // スクロール可能範囲内であることを確認
      final double maxScrollExtent =
          _navigationScrollController.position.maxScrollExtent;
      final double clampedOffset = targetOffset.clamp(0.0, maxScrollExtent);

      // アニメーションでスクロール
      _navigationScrollController.animateTo(
        clampedOffset,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    });
  }

  /// 現在の問題の状態を復元
  void _restoreCurrentQuestionState() {
    if (_questions.isEmpty) return;

    final question = _questions[_currentIndex];
    final questionId = question.id.toString();

    // 回答済みかチェック
    if (_currentAnswers.containsKey(questionId)) {
      _isAnswered = true;
      _selectedChoice = _currentAnswers[questionId];

      // 正解かチェック
      final correctChoiceIndex = _getCorrectChoiceIndex(question);
      _isCorrect = _selectedChoice == correctChoiceIndex;
    } else {
      _isAnswered = false;
      _isCorrect = false;
      _selectedChoice = null;
    }
  }

  /// 現在の状態を保存（重複保存を防ぐ）
  Future<void> _saveCurrentState() async {
    // 復習モードではセッション保存を行わない（PRD: 再開不可）
    if (widget.config.isReviewMode) return;
    if (_currentSessionId == null) return;

    // dispose済みの場合は保存をスキップ
    if (!mounted) {
      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _saveCurrentState スキップ（widget disposed）',
          tag: 'SessionSaveDebug',
          data: {'timestamp': DateTime.now().toIso8601String()},
        );
      }
      return;
    }

    if (kDebugMode) {
      AppLogger.d(
        '[SessionSaveDebug] _saveCurrentState 開始',
        tag: 'SessionSaveDebug',
        data: {
          'timestamp': DateTime.now().toIso8601String(),
          'sessionId': _currentSessionId,
          'currentIndex': _currentIndex,
          '_currentAnswers': _currentAnswers.toString(),
          '_isAnswered': _isAnswered,
          '_selectedChoice': _selectedChoice,
        },
      );
    }

    try {
      final sessionData = {
        // 学習設定を保持
        'domain': widget.config.domain,
        'domainTitle': widget.config.domainTitle,
        'selectedCategories': widget.config.selectedCategories.toList(),
        'selectedSubcategories': widget.config.selectedSubcategories.toList(),
        'selectedYears': widget.config.selectedYears.toList(),
        'timerEnabled': widget.config.timerEnabled,
        'shuffleQuestions': widget.config.shuffleQuestions,
        'unansweredOnly': widget.config.unansweredOnly,
        // 進捗データ
        'currentIndex': _currentIndex,
        'answers': _currentAnswers,
        'progress': {
          'answered': _currentAnswers.length,
          'correct': _correctCount,
          'total': _questions.length,
        },
        'currentQuestionState': {
          'isAnswered': _isAnswered,
          'isCorrect': _isCorrect,
          'selectedChoice': _selectedChoice,
        },
        // 問題IDリストを保存（シャッフル対応）
        'questionIds': _questions.map((q) => q.id.toString()).toList(),
      };

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _saveCurrentState: saveSessionData呼び出し前',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionData.answers': sessionData['answers'].toString(),
          },
        );
      }

      // ANR対策: 画面遷移時はリトライを無効化（軽量保存）
      await _sessionService.saveSessionData(
        _currentSessionId!,
        sessionData,
        allowRetry: false,
      );

      if (kDebugMode) {
        AppLogger.d(
          '[SessionSaveDebug] _saveCurrentState 完了',
          tag: 'SessionSaveDebug',
          data: {
            'timestamp': DateTime.now().toIso8601String(),
            'sessionId': _currentSessionId,
          },
        );
      }
    } catch (e) {
      if (kDebugMode) {
        AppLogger.e(
          '[SessionSaveDebug] _saveCurrentState エラー',
          tag: 'SessionSaveDebug',
          error: e,
          data: {'timestamp': DateTime.now().toIso8601String()},
        );
      }
      // エラーハンドリング
    }
  }

  /// アプリライフサイクル変更時の処理
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);

    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.inactive:
        // アプリがバックグラウンドに移行または非アクティブ状態
        _saveCurrentState();
        break;
      case AppLifecycleState.resumed:
        // アプリがフォアグラウンドに復帰
        break;
      default:
        break;
    }
  }

  void _showCompletionDialog() {
    // 重複表示防止チェック
    if (!DialogPreferenceService.shouldShowCompletionDialog()) {
      return;
    }

    // 学習完了時にセッションをクローズ
    if (_currentSessionId != null) {
      _sessionService.closeSession(_currentSessionId!);
    }

    // 表示開始をマーク
    DialogPreferenceService.markCompletionDialogShowing();

    // 復習モードの場合は異なるダイアログを表示
    if (widget.config.isReviewMode) {
      // 復習モードでも実際に回答した問題数を表示
      final answeredCount = _currentAnswers.length;
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('復習完了'),
          content: Text('$answeredCount問の復習が完了しました。'),
          actions: [
            TextButton(
              onPressed: () {
                AppLogger.i('ホームに戻るボタンタップ', tag: '復習完了');
                // 表示終了をマーク
                DialogPreferenceService.markCompletionDialogNotShowing();
                Navigator.of(dialogContext).pop(); // ダイアログを閉じる
                Navigator.of(context).pop(); // 学習画面を閉じる
                // Go Routerを使用してホーム画面に直接遷移
                context.go('/');
                AppLogger.i('ホーム画面に戻りました', tag: '復習完了');
              },
              child: const Text('ホームに戻る'),
            ),
            TextButton(
              onPressed: () {
                AppLogger.i('復習を続けるボタンタップ', tag: '復習完了');
                // 表示終了をマーク
                DialogPreferenceService.markCompletionDialogNotShowing();
                Navigator.of(dialogContext).pop(); // ダイアログを閉じる
                Navigator.of(context).pop(); // 学習画面を閉じる
                // Go Routerを使用して復習確認画面に遷移
                context.go('/review');
                AppLogger.i('復習確認画面に戻りました', tag: '復習完了');
              },
              child: const Text('復習を続ける'),
            ),
          ],
        ),
      );
    } else {
      // 通常モードの場合：実際に回答した問題数を表示
      final answeredCount = _currentAnswers.length;
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('学習完了'),
          content: Text('$answeredCount問の学習が完了しました。'),
          actions: [
            TextButton(
              onPressed: () {
                AppLogger.i('ホームに戻るボタンタップ', tag: '学習完了');
                // 表示終了をマーク
                DialogPreferenceService.markCompletionDialogNotShowing();
                Navigator.of(dialogContext).pop(); // ダイアログを閉じる
                Navigator.of(context).pop(); // 学習画面を閉じる
                // Go Routerを使用してホーム画面に直接遷移
                context.go('/');
                AppLogger.i('ホーム画面に戻りました', tag: '学習完了');
              },
              child: const Text('ホームに戻る'),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    // ✅ 対策E: プログレスインジケータ改善
    if (_isLoading) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('問題を読み込み中...'),
            ],
          ),
        ),
      );
    }

    if (_questions.isEmpty) {
      return Scaffold(
        appBar: HomeAppBar.basic(
          title: '学習',
          backgroundColor: Theme.of(context).colorScheme.surface,
        ),
        body: const Center(child: Text('問題が見つかりませんでした。')),
      );
    }

    return PopScope(
      onPopInvoked: (didPop) {
        if (kDebugMode) {
          AppLogger.d(
            '[SessionSaveDebug] onPopInvoked 実行',
            tag: 'SessionSaveDebug',
            data: {
              'timestamp': DateTime.now().toIso8601String(),
              'didPop': didPop,
              '_currentSessionId': _currentSessionId,
              '_currentAnswers': _currentAnswers.toString(),
              '_currentIndex': _currentIndex,
              '_isAnswered': _isAnswered,
            },
          );
        }

        // ANR対策: 画面がPOP済みの場合のみ、非ブロッキングで保存
        // didPop = true: 画面はすでにPOP済み
        // didPop = false: POPをキャンセル可能（canPop: falseの場合）
        if (didPop) {
          if (kDebugMode) {
            AppLogger.d(
              '[SessionSaveDebug] _saveCurrentState呼び出し（didPop=true）',
              tag: 'SessionSaveDebug',
              data: {'timestamp': DateTime.now().toIso8601String()},
            );
          }

          // 完了を待たずに保存開始、エラーは記録のみ
          _saveCurrentState().catchError((e) {
            AppLogger.e(
              '[SessionSaveDebug] 画面遷移後のセッション保存失敗',
              error: e,
              tag: 'SessionSaveDebug',
              data: {'timestamp': DateTime.now().toIso8601String()},
            );
          });
        }
      },
      child: Builder(
        builder: (context) {
          if (kDebugMode) {
            AppLogger.d(
              '[SessionSaveDebug] QuestionScreen構築',
              tag: 'SessionSaveDebug',
              data: {
                'timestamp': DateTime.now().toIso8601String(),
                'currentIndex': _currentIndex,
                'isAnswered': _isAnswered,
                'selectedChoice': _selectedChoice,
                'practiceAnswers（渡す値）': _currentAnswers.toString(),
                'answeredQuestionsKeys': _currentAnswers.keys
                    .toSet()
                    .toString(),
              },
            );
          }

          return QuestionScreen(
            config: QuestionScreenConfig(
              questions: _convertToExtendedQuestions(_questions),
              choices: _convertToChoicesFromRepository(
                _questions[_currentIndex].choices,
              ),
              currentQuestionIndex: _currentIndex,
              examType: 'practice',
              isAnswered: _isAnswered,
              showExplanation: _isAnswered,
              selectedChoiceIndex: _selectedChoice,
              isInReviewList: _isInReviewList,
              isReviewSession: widget.config.isReviewMode, // 復習モード識別
            ),
            callbacks: QuestionScreenCallbacks(
              onNavigateToQuestion: _goToQuestion,
              onQuestionAnswered: (questionIndex, choiceIndex, isCorrect) {
                _answerQuestion(choiceIndex);
              },
              onPreviousQuestion: _currentIndex > 0 ? _previousQuestion : null,
              onNextQuestion: _currentIndex < _questions.length - 1
                  ? _nextQuestion
                  : null,
              onShowResults: _currentIndex == _questions.length - 1
                  ? _showCompletionDialog
                  : null,
              onHomePressed: () {
                // 学習画面を閉じてホーム画面に遷移
                Navigator.of(context).pop();
                context.go('/');
              },
              // 復習リスト追加：回答済みであれば追加可能（正解・不正解問わず、復習リストの状態に関係なく）
              // question_screen.dartの_toggleReview()がトグル機能を実装
              onAddToReview: _isAnswered ? _addToReview : null,
              onRemoveFromReview: widget.config.isReviewMode
                  ? _removeFromReviewAndGoNext
                  : (_isAnswered ? _removeFromReview : null),
            ),
            displayOptions: QuestionDisplayOptions(
              showTimer: widget.config.timerEnabled,
              showNavigation: true, // 問題ナビゲーションバーを表示
              // 復習モード用のヘッダー情報
              reviewSortOrder: widget.config.isReviewMode
                  ? widget.config.reviewSortOrder
                  : null,
              reviewTotalCount: widget.config.isReviewMode
                  ? _questions.length
                  : null,
              reviewCurrentIndex: widget.config.isReviewMode
                  ? _currentIndex
                  : null,
            ),
            reviewState: QuestionReviewState(
              answeredQuestions: _currentAnswers.keys.toSet(), // 回答済み問題IDセット
              practiceAnswers: _currentAnswers, // 年度別・分野別学習用の回答状況
            ),
            timerState: widget.config.timerEnabled
                ? QuestionTimerState(timerSeconds: _timerSeconds)
                : null,
            navigationScrollController:
                _navigationScrollController, // ナビゲーション用ScrollController
          );
        },
      ),
    );
  }

  /// 正解の選択肢のインデックスを取得
  int _getCorrectChoiceIndex(QuestionWithDetails question) {
    // 選択肢の中から正解のchoiceNoと一致するものを探す
    for (int i = 0; i < question.choices.length; i++) {
      if (question.choices[i].choiceNo == question.correctChoice) {
        return i;
      }
    }
    return 0; // デフォルト値（見つからない場合）
  }

  /// 分野名の表示用変換
  String _getDomainDisplayName(String domainKey) {
    switch (domainKey) {
      case 'strategy':
        return 'ストラテジ系';
      case 'management':
        return 'マネジメント系';
      case 'technology':
        return 'テクノロジ系';
      default:
        return domainKey;
    }
  }

  /// QuestionChoiceをChoiceに変換（リポジトリ用）
  List<Choice> _convertToChoicesFromRepository(
    List<QuestionChoice> questionChoices,
  ) {
    return questionChoices
        .map(
          (qChoice) => Choice(
            id: qChoice.id.toString(),
            questionId: _questions[_currentIndex].id,
            choiceNo: qChoice.choiceNo,
            text: qChoice.text,
          ),
        )
        .toList();
  }

  /// QuestionWithDetailsをExtendedQuestionに変換
  List<ExtendedQuestion> _convertToExtendedQuestions(
    List<QuestionWithDetails> questions,
  ) {
    return questions
        .map(
          (q) => ExtendedQuestion(
            id: q.id,
            questionNumber: q.questionNumber,
            examPeriodId: q.examPeriod.id,
            domainId: q.category.domainId,
            majorId: q.category.majorId,
            minorId: q.category.minorId,
            text: q.text,
            explanation: q.explanation,
            correctChoice: q.correctChoice,
            textMd: q.text,
            explanationMd: q.explanation,
            // テーブルデータを変換
            tables: q.tables.map((tableData) {
              // JSONをパース
              final columns =
                  (jsonDecode(tableData.columnsJson) as List<dynamic>)
                      .map((e) => e.toString())
                      .toList();
              final rows = (jsonDecode(tableData.rowsJson) as List<dynamic>)
                  .map(
                    (row) => (row as List<dynamic>)
                        .map((cell) => cell.toString())
                        .toList(),
                  )
                  .toList();

              return QuestionTable(
                id: tableData.id,
                questionId: tableData.questionId,
                name: tableData.name,
                columns: columns,
                rows: rows,
                sortOrder: tableData.sortOrder,
              );
            }).toList(),
            // 問題タイプを設定（テーブルがある場合はtable、ない場合はmcq_text）
            questionType: q.tables.isNotEmpty ? 'table' : 'mcq_text',
          ),
        )
        .toList();
  }

  /// 続きから学習ダイアログの表示チェック
  Future<void> _checkAndShowResumeDialog() async {
    try {
      // 重複表示防止機能付きでダイアログを表示
      if (mounted) {
        // 少し遅延してからダイアログを表示（画面の初期化完了後）
        await Future.delayed(const Duration(milliseconds: 500));
        if (mounted) {
          await ResumeLearningDialog.show(context);
        }
      }
    } catch (e) {
      // エラーハンドリング
    }
  }

  /// Analyticsユーザープロパティを更新
  Future<void> _updateAnalyticsUserProperties() async {
    try {
      final stats = await _questionService.getLearningStats();
      final accuracyRate = stats.totalAnswered > 0
          ? stats.correctAnswers / stats.totalAnswered
          : 0.0;

      await UserPropertiesHelper.setCurrentAccuracyRate(accuracyRate);
      await UserPropertiesHelper.setTotalQuestionsAnswered(stats.totalAnswered);
    } catch (e) {
      // Analytics失敗でもアプリは継続
      AppLogger.d('[Analytics] ユーザープロパティ更新エラー: $e', tag: 'Analytics');
    }
  }
}
