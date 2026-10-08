COOK
FARM
sanity
DEATH

黄金园艺锄 字体

把库存改为存实体

把packages/signals/src/handEquipment.ts改为工厂模式，将全局的 handEquipmentState 替换为动态传入的 slotSignal，这是一个典型的依赖注入（Dependency Injection）和解耦（Decoupling）的改进。


main.ts syncHandEquipment