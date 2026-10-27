import { analysisSchema, type AnalysisDocument } from '@/lib/schema';

export const demo: AnalysisDocument = analysisSchema.parse({
  schemaVersion: 1,
  id: 'resent',
  createdAt: '2026-02-14T09:20:00.000Z',
  target: 'resent',
  language: '美式英语',
  dimensions: {
    one: {
      overview: {
        pronunciation: '/rɪˈzent/',
        core: '把那份不公平，留在心里。',
        definition:
          '对已经发生的亏待、轻慢或不公感到不满，判断落在“这件事不该这样”上。这种不满可以说出口、可以当面讲，也可以只在心里记账。',
        partOfSpeech: 'verb · 及物动词',
      },
      origin: {
        story:
          'resent 从法语 ressentir 进入英语，法语这个词又来自拉丁语 sentire（感觉）；前面的 re- 在法语构词里通常起加强作用，意思是“深深地感到”。所以早期的 resent 是“感受到、被某事触动”：可以感受到痛苦，也可以感受到别人的好意。后来这条“感受”专门落在受伤和被亏待的场合，一旦加上“这不该发生在我身上”的判断，情绪就成了不满。',
        physicalImage:
          '把手掌贴在粗粝的石面上。扎人的触感变成心里的一句“凭什么这样对我”，resent 把这份被亏待的感觉叫出了名字。',
        evolution: [
          {
            id: 'latin',
            label: '拉丁语 sentire',
            period: '拉丁语',
            meaning: '“感觉、感知、判断”，也用于“认为、持某种看法”。',
            connection:
              '法语 ressentir 把 sentire 的“感觉”加深了一层：身体能深切地感到疼痛，心里也能深切地感到他人的态度。',
            example: {
              en: 'sentire — “to feel, to perceive, to judge.”',
              zh: 'sentire ——“感觉、感知、判断”。',
            },
          },
          {
            id: 'french',
            label: '古法语 ressentir',
            period: '古法语',
            meaning: '“感觉到、受……影响”。',
            connection:
              '法语把 sentire 的“感觉”同时用在身体和情绪两头。英语从这里接手，因此早期的 resent 还不专指愤怒。',
            example: {
              en: 'Il ressent encore la blessure. — “He still feels the injury.”',
              zh: '他仍然感觉得到那道伤。同源的法语里，这个词停在“感觉”这一层。',
            },
          },
          {
            id: 'early-english',
            label: '早期英语 resent',
            period: '进入英语之后',
            meaning: '“感受到、被……触动”，情感色彩由上下文决定；可以说 resent a kindness（感受到别人的好意）。',
            connection:
              '这一时期它描写的是一次“被触动”，中性与负面两种用法并存过一段时间，中性那条后来退出了日常。',
            example: {
              en: 'Early writers could resent a kindness: the word simply meant “to feel it.”',
              zh: '早期作者可以写 resent a kindness：这个词当时的意思就是“感受到它”。',
            },
          },
          {
            id: 'modern',
            label: '现代美语 resent',
            period: '现代',
            meaning: '“对不公、轻慢、被亏待不满”，判断落在“不该这样”上。',
            connection:
              '负面用法固定下来之后，resent 自带一个评价：这件事不该这样对我。情绪可以是压着的，也可以是当面说重话的。',
            example: {
              en: 'She resents being passed over for the promotion.',
              zh: '她对晋升时被跳过这件事，心里一直不平。',
            },
          },
        ],
      },
      bloodline: {
        family: '法语借入 · 拉丁词根',
        route: ['拉丁语 sentire（感觉）', '法语 ressentir（感到）', '英语 resent（不满）'],
        socialFeel:
          'resent 是一个“把账摆上桌”的词：语气可以从冷静到激烈，场合可以从私下到会议室。它的分量来自那个判断——我受到了不公平的对待——音量只是外壳。',
        root: 'sentire',
        cognates: [
          {
            word: 'sense',
            meaning: '感觉；察觉；判断力',
            connection: '最朴素的同根词：走到“察觉、有感觉”为止，评价留给上下文。',
          },
          {
            word: 'sentiment',
            meaning: '情感；看法（常带温情或客套色彩）',
            connection: '感觉被固定成一种态度。sentiment 可以善意，resent 走的是负面那条。',
          },
          {
            word: 'consent',
            meaning: '同意',
            connection: 'con-（共同）+ sentire：感觉一致，所以点头。resent 的感觉朝相反方向走。',
          },
          {
            word: 'dissent',
            meaning: '不同意，常指正式、公开的异议',
            connection: 'dis-（分开）+ sentire：感觉分开。dissent 是立场上的异议，resent 是个人受到的不公。',
          },
        ],
      },
    },
    two: {
      concept: {
        scene:
          '季度晋升名单在周五下午贴出来。你带的项目救过一次上线，名单上却是别人的名字；会上还有人总结说“这是团队的成果”。',
        trigger:
          '触发点是“我被不公平地对待了”这个主观判断：可能有人明知真相仍然这样定，也可能只是你确信自己的付出被抹掉了。resent 要的是一个能指认的亏待，加上你认为该为此负责的人或规则。',
        psychology:
          '它把“我受了亏待”变成一句待结的账：可以当面说出口，也可以自己收着；可以是一句冷冷的 I resent that，也可以是当场加重语气的抗议。共同点是那句还没得到回答的“凭什么”。',
        intensity:
          '弹性很大：轻的是一句压着说的话，重的是会议桌上当场的强硬表态。它比 annoyed 带更明确的道德判断，比 furious 更可控，也可以拖得很久。',
        boundary:
          '边界在“不公判断”。只想要别人手里的东西用 envy；只针对某个措辞提异议用 take exception to；事后只觉得可惜用 regret；要把不满变成可提交的申诉，才进入 grievance 那一套。',
        translation: {
          common: '怨恨／愤愤不平',
          adds:
            '“怨恨”把强度和长期性带了进来，也常指向具体的人；“愤愤不平”更贴近对不公的那股气。两个词都补上了中文习惯的“心里有气”这一面。',
          misses:
            '英语的 resent 常指当场、公开的一次表态（I resent that），译成“怨恨”容易显得闷了很久；它含的那层“你这是在轻视我”，中文要另说一句才落得下来。',
        },
      },
      nuance: {
        sharedScene:
          '同一张晋升名单：方案是你写的，汇报是同事做的，升职的是他。下面三句话说的都是这件事，但各自咬住的东西不一样。',
        words: [
          {
            word: 'resent',
            image: '一块压在胸口的冷铁，不响，但一直在。',
            register: 5,
            distinction:
              '不满落在“这件事不该这样”，对象偏事；既可以当众说，也可以收着，结构上接动名词或 that 从句。',
            example: {
              en: 'I resent that my name never came up when they announced the promotion.',
              zh: '他们宣布晋升的时候，一次都没提到我的名字，这件事我一直不平。',
            },
          },
          {
            word: 'begrudge',
            image: '一只攥着不肯松开的手。',
            register: 6,
            distinction:
              '着眼“不愿看到他得到”，可以是觉得他不配，也可以纯粹是小气；典型结构是 begrudge somebody something，落点在别人的所得。',
            example: {
              en: "I don't begrudge him the title; I begrudge how he got it.",
              zh: '那个头衔给他，我并不心疼；我过不去的是他拿到它的方式。',
            },
          },
          {
            word: 'envy',
            image: '隔着玻璃看别人桌上的东西。',
            register: 5,
            distinction:
              '只描述“我也想有”，含不公判断的情形很少，甚至能出现在赞美里；对象是那个好处本身。',
            example: {
              en: 'I envy his timing more than his title.',
              zh: '比起他的头衔，我更羡慕他出手的时机。',
            },
          },
        ],
      },
    },
    three: {
      register: {
        score: 5,
        persona:
          '成年场合里地位相当的一方；说出口时通常已经想清楚，语气可以从平静到强硬。',
        prosody: 'negative',
        prosodyExplanation:
          '无论说得轻还是重，评价都压在“不该这样”上：轻的时候靠选词表达，重的时候重音落在 -sent，句尾下沉。',
        subtext: '这件事我记住了，而且我认为该有人给个说法。',
        levels: [
          {
            level: 1,
            label: '粗俗与禁忌表达',
            candidates: [],
          },
          {
            level: 2,
            label: '同龄人俚语',
            candidates: [
              {
                word: 'be salty about (something)',
                nuance: '带嘲弄的“心里不平衡”，常指输不起的小情绪，也常被半开玩笑地用。',
                persona: '熟悉网络、游戏或体育话语的朋友。',
                prosody: '语调上扬带笑，重音在 sal-，句尾常拖长。',
                shift:
                  '“不公判断”被抽走，只剩情绪表演：从“规则错了”滑到“你在闹别扭”，正式维权时用不上。',
                example: {
                  en: "He's still salty about not getting the nod.",
                  zh: '他还在为没被点名升职的事闹别扭。',
                },
              },
            ],
          },
          {
            level: 3,
            label: '口语抱怨',
            candidates: [
              {
                word: 'be sore about (something)',
                nuance: '心里过不去，还带一点委屈和不甘心。',
                persona: '同事、队友之间，比 salty 认真一档。',
                prosody: '平调，重音在 sore，常与 still 连用。',
                shift:
                  '保住了“这事让我难受”，举证门槛更低：输了球的不甘也能用 sore，是否不公由上下文交代。',
                example: {
                  en: "She's still sore about how the review went.",
                  zh: '她对那次评审的走向还是过不去。',
                },
              },
            ],
          },
          {
            level: 4,
            label: '日常口语：把账记在人头上',
            candidates: [
              {
                word: 'hold it against (somebody)',
                nuance: '把这件事记在某人账上，日后可能拿出来算。',
                persona: '家人、朋友、长期共事的同事。',
                prosody: 'it 轻读，重音落在 against，语气像在记账。',
                shift:
                  '对象从“事”转到“人”：resent 可以只对事，hold it against 一定有人被记着，而且暗示以后会兑现。',
                example: {
                  en: "I don't hold it against him, but I stopped covering for him.",
                  zh: '这事我没算在他头上，只是不再替他兜底了。',
                },
              },
              {
                word: 'bear a grudge',
                nuance: '一直记着一份怨气，日常交谈和叙事都能用。',
                persona: '谈论往事、家人或同事的人。',
                prosody: '重音在 grudge，bear a 通常连读。',
                shift: '焦点转向持续记恨：它突出怨气留了多久，不要求当场说出不公的理由。',
                example: {
                  en: 'He still bears a grudge against his old manager.',
                  zh: '他对以前的经理仍然怀着怨气。',
                },
              },
            ],
          },
          {
            level: 5,
            label: '中性基准：resent 本词',
            candidates: [
              {
                word: 'resent',
                nuance: '基准义：对不公不满，判断明确；私下说、当众说都成立。',
                persona: '任何成年场合；说出口就是一次明确表态。',
                prosody: '重音在 -sent，语调可平可硬。',
                shift: '无偏移——其他各档都以这一档为原点。',
                example: {
                  en: 'I resent that my name never came up.',
                  zh: '会上一次没提我的名字，这件事我一直不平。',
                },
              },
            ],
          },
          {
            level: 6,
            label: '略偏书面的表达',
            candidates: [
              {
                word: 'take exception to (something)',
                nuance: '公开表示“这个说法我不接受”，偏当场异议。',
                persona: '在会议、邮件里据理力争的人。',
                prosody: '节奏稳，重音在 -cep-，后面常紧跟一个具体措辞。',
                shift:
                  '焦点从“我受了亏待”转到“这句具体的话我要求更正”：resent 说的是处境，take exception to 咬的是措辞。',
                example: {
                  en: "I take exception to the phrase 'team effort' here.",
                  zh: '这里用“团队努力”这个说法，我不接受。',
                },
              },
              {
                word: 'begrudge (somebody something)',
                nuance: '不愿别人得到，落点在别人的所得。',
                persona: '自认贡献被覆盖的人，话里带一点刺。',
                prosody: '重音在 -grudge，语气下沉。',
                shift:
                  '从“这件事不公”转到“你不配拿”：指控对象变成人，力度更冲，也更容易被听成小气。',
                example: {
                  en: "I don't begrudge him the promotion. I begrudge the silence around it.",
                  zh: '那个晋升给他，我并不心疼；我过不去的是没人提这件事。',
                },
              },
              {
                word: 'nurse a grudge',
                nuance: '像养着旧伤一样留着怨气，带有叙事色彩。',
                persona: '描述人物心理、同事关系或旧事的人。',
                prosody: '重音在 nurse 和 grudge，语速通常较慢。',
                shift: '从对某件事不满转成主动留着怨气；nurse 的比喻让这份不满有了持续滋养的意味。',
                example: {
                  en: "He's been nursing a grudge since the spring review.",
                  zh: '从春季评审起，他就一直把这事记着。',
                },
              },
            ],
          },
          {
            level: 7,
            label: '正式书面语',
            candidates: [
              {
                word: 'feel aggrieved',
                nuance: '觉得自己受了委屈，书面、程序化的委屈。',
                persona: '写申诉、写复盘的人；人力资源邮件里常见。',
                prosody: '语速慢，重音在 -grieved，整体偏冷。',
                shift:
                  '重心落在说话人觉得自己受了委屈，适合较正式地描述当事人的感受。',
                example: {
                  en: 'She felt aggrieved by how the reassignment was handled.',
                  zh: '那次调岗的处理方式让她觉得自己受了委屈。',
                },
              },
              {
                word: 'harbor resentment',
                nuance: '长期怀有，名词化之后情绪变成一件随身带着的物件。',
                persona: '书面评论、心理咨询、组织行为类文章。',
                prosody: '语速平稳，har- 与 -sent- 都有重音。',
                shift:
                  '动词变成名词短语：不再指向某一次具体行为，而是一种状态，责任方也随之模糊。',
                example: {
                  en: 'Whole teams harbor resentment long after the reorg.',
                  zh: '重组过去很久了，整个团队的不满还留着。',
                },
              },
            ],
          },
          {
            level: 8,
            label: '高度正式的论述',
            candidates: [],
          },
          {
            level: 9,
            label: '机构与法律邻近语域',
            candidates: [
              {
                word: 'lodge a formal grievance',
                nuance: '把对待遇的不满提交为正式申诉，进入机构处理程序。',
                persona: '员工、工会代表或人力资源专员。',
                prosody: '节奏清晰，重音落在 lodge 和 griev-。',
                shift:
                  '从感受转到行动：resent 描写心里的不满；lodge a formal grievance 表示已经提出正式申诉。',
                example: {
                  en: 'She lodged a formal grievance over the promotion process.',
                  zh: '她就晋升程序提出了正式申诉。',
                },
              },
            ],
          },
          {
            level: 10,
            label: '学术与法律术语',
            candidates: [],
          },
        ],
      },
      chunks: {
        items: [
          {
            phrase: 'resent being + 过去分词',
            meaning: '“对被人这样对待不满”。主语是被动承受的一方，动词后面跟动名词。',
            example: {
              en: 'She resents being left out of the loop on the rollout.',
              zh: '上线的事她一直被排除在决策圈外，这一点她很在意。',
            },
          },
          {
            phrase: 'resent somebody for (doing) something',
            meaning: '把不满落到具体的人身上，for 引出“因为哪件事”。',
            example: {
              en: 'He resents his manager for taking the credit.',
              zh: '他记恨经理把功劳拿走了。',
            },
          },
          {
            phrase: 'resent the implication',
            meaning: '固定搭配：针对话里带着的那个意思，而不是字面内容。被暗指时最常用。',
            example: {
              en: "I resent the implication that I didn't try.",
              zh: '话里暗示我没努力，这一点我不接受。',
            },
          },
          {
            phrase: 'deeply / bitterly resent',
            meaning: 'deeply 说深度，bitterly 说带苦味；bitterly 更重，通常指向多年的事。',
            example: {
              en: 'She deeply resents the way the decision was made.',
              zh: '那个决定是怎么做出来的，她心里深为不平。',
            },
          },
          {
            phrase: 'I resent that.',
            meaning: '短句回击，等于“这话我不接”，用在被当面定性的时候；可以冷，也可以当场加重语气。',
            example: {
              en: "— You're the one who dropped the ball. — I resent that.",
              zh: '——“是你在关键环节掉了链子。”——“这话我不接。”',
            },
          },
        ],
        culture: [],
      },
      pitfalls: {
        items: [
          {
            wrong: 'I resent to be passed over for the promotion.',
            right: 'I resent being passed over for the promotion.',
            explanation:
              'resent 后面接动名词或 that 从句，接不定式的结构在英语里立不住。中文“我不满被跳过”里的“被”字，会把人推向 to be 的形状。',
            image: '一条只能走 -ing 的路，to do 那条是死胡同。',
            translation: '晋升时被跳过，我心里不平。',
          },
          {
            wrong: 'I resent about the way the decision was made.',
            right: 'I resent the way the decision was made.',
            explanation:
              'resent 是及物动词，直接带宾语，中间不加 about。for 出现在另一个结构里：resent somebody for something，用来点明不满落在谁身上、为了哪件事。',
            image: 'resent 伸手直接抓宾语，中间没有介词这一步。',
            translation: '那个决定的形成方式，让我一直不平。',
          },
          {
            wrong: 'I resent his new car.',
            right: 'I envy his new car.',
            explanation:
              '想要别人拥有的东西，用 envy；resent 需要一个“被亏待”的事由。说 I resent his new car，听者会先找那辆车对你做了什么。',
            image: '同一件事的两个方向：一个想要那份好处，一个觉得自己被亏待。',
            translation: '我羡慕他那辆新车。',
          },
        ],
      },
      slices: {
        dialogues: [
          {
            setting: 'friends',
            title: '停车场，晚上十点',
            lines: [
              {
                speaker: 'Maya',
                en: 'They gave it to Dev.',
                zh: '他们把职位给 Dev 了。',
                annotation: '先把事实摆出来，评论留到下一句——这是抱怨常见的起手式。',
              },
              {
                speaker: 'Jonah',
                en: 'Ouch. Are you going to say something?',
                zh: '哎。你打算说点什么吗？',
                annotation: 'Are you going to... 是朋友之间最常用的“你准备怎么办”。',
              },
              {
                speaker: 'Maya',
                en: 'I resent that nobody mentioned my name. Not once.',
                zh: '一次都没人提我的名字。我过不去的是这个。',
                annotation: 'resent 后面直接跟 that 从句：指控的是“这件事”，针对点很具体。',
              },
              {
                speaker: 'Jonah',
                en: "That's not sour grapes. That's a paper trail.",
                zh: '这可不是酸葡萄，这是有据可查的事。',
                annotation: 'sour grapes 把不满贬成“得不到就说不好”，这里用来划清界限。',
              },
            ],
          },
          {
            setting: 'work',
            title: '绩效面谈之后的走廊',
            lines: [
              {
                speaker: 'Priya',
                en: 'Do you have five minutes?',
                zh: '你有五分钟吗？',
                annotation: '美式职场里，真正严肃的话常从走廊开始，不在会上。',
              },
              {
                speaker: 'Marcus',
                en: 'If this is about the launch, I already know.',
                zh: '如果是为了上线那件事，我已经知道了。',
                annotation: '用 I already know 抢先认下来，把场面接住。',
              },
              {
                speaker: 'Priya',
                en: "I take exception to 'supporting role.' I wrote the rollout plan.",
                zh: '我不接受“辅助角色”这个说法。上线方案是我写的。',
                annotation: 'take exception to 后面跟具体措辞，等于“这句话我要求更正”。',
              },
              {
                speaker: 'Marcus',
                en: "Then let's fix the record today.",
                zh: '那我们今天就把它改对。',
                annotation: '把不满落成具体动作，是这类走廊对话常见的收尾。',
              },
            ],
          },
          {
            setting: 'culture',
            title: '播客录音间：轻描淡写的不满',
            lines: [
              {
                speaker: 'Host',
                en: "Why does 'I resent that' sound polite and hostile at the same time?",
                zh: '为什么 I resent that 听起来既客气又带刺？',
                annotation: '问题点出这个词的双层结构：措辞礼貌，判断强硬。',
              },
              {
                speaker: 'Guest',
                en: 'Because it names a standard instead of an insult.',
                zh: '因为它给出的是标准，不是骂人。',
                annotation: 'name a standard：把不满挂到“本该怎样”上。',
              },
              {
                speaker: 'Guest',
                en: 'Early on you could resent a kindness. The word only turned bitter later.',
                zh: '早期英语里，你甚至可以 resent 一份好意；这个词是后来才带上苦味的。',
                annotation: '历史层：从“感受到”到“对不公不满”，是词义演变。',
              },
              {
                speaker: 'Host',
                en: 'So the modern word carries a verdict.',
                zh: '所以现代这个词总是带着一个判断。',
                annotation: 'verdict 把 resent 内含的“不公判断”说清楚了。',
              },
            ],
          },
        ],
        quiz: [
          {
            id: 'q-credit',
            scenario: '同事在全员会上讲了你的方案，散会后有人对你说“他讲得真好”。',
            challenge: '用 resent 造一句，说明你 resent 的是哪一层，并解释这里为什么不用 envy。',
            focus: 'resent 接 that 从句或动名词，针对的是“被抹掉”这件事；envy 只表示“我也想有他的位置”。',
            reference: {
              en: "I resent that my work was presented as his thinking. I don't envy his slot; I mind how he got it.",
              zh: '我不平的是我的工作被讲成了他的想法；他那把椅子我并不羡慕，我过不去的是他拿到它的方式。',
            },
            hints: [
              { term: '同事', en: 'colleague/coworker' },
              { term: '全员会', en: 'all-hands meeting' },
              { term: '方案', en: 'proposal/plan' },
              { term: '散会后', en: 'after the meeting' },
              { term: '造一句', en: 'write a sentence' },
              { term: '哪一层', en: 'which layer' },
              { term: '解释', en: 'explain' },
            ],
          },
          {
            id: 'q-history',
            scenario: '读到一句早期英语：She resented the kindness of strangers.',
            challenge: '这句里的 resent 和今天的“不满”差在哪？用一句话说清两层意思的关系。',
            focus: '词义演变：早期是“感受到、被触动”，负面“对不公之怒”是后来才固定下来的一层。',
            reference: {
              en: 'There it means she felt it, she was moved by it. The indignation is a later layer.',
              zh: '那里是说她感受到了、被打动了；“对不公的愤怒”是后来才加上去的一层。',
            },
            hints: [
              { term: '读到', en: 'read/come across' },
              { term: '早期英语', en: 'early English' },
              { term: '这句', en: 'this sentence' },
              { term: '今天', en: 'today/present-day' },
              { term: '差在哪', en: 'how it differs' },
              { term: '一句话', en: 'in one sentence' },
              { term: '两层意思', en: 'two layers of meaning' },
              { term: '关系', en: 'relationship' },
            ],
          },
        ],
      },
    },
  },
});
